// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  MAX_TRACKED_KEYS,
  RESET_IP_LIMIT,
  RESET_IP_WINDOW_MS,
  createRateLimiter,
  originAllowed,
} from "./password-reset-limit";

const MINUTE = 60_000;

/** A clock the test moves by hand. */
function fakeClock(start = Date.UTC(2026, 9, 5, 9, 0)) {
  let time = start;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const takeTimes = (take: () => boolean, times: number) =>
  Array.from({ length: times }, () => take());

describe("createRateLimiter", () => {
  test("defaults to 20 requests per address in 15 minutes", () => {
    expect(RESET_IP_LIMIT).toBe(20);
    expect(RESET_IP_WINDOW_MS).toBe(15 * MINUTE);
    const clock = fakeClock();
    const limiter = createRateLimiter({ now: clock.now });
    expect(takeTimes(() => limiter.take("203.0.113.7"), RESET_IP_LIMIT).every(Boolean)).toBe(true);
    expect(limiter.take("203.0.113.7")).toBe(false);
  });

  test("allows up to the limit, then refuses until the oldest request leaves the window", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 15 * MINUTE, now: clock.now });
    expect(limiter.take("a")).toBe(true); // t = 0
    clock.advance(MINUTE);
    expect(limiter.take("a")).toBe(true); // t = 1 min
    clock.advance(MINUTE);
    expect(limiter.take("a")).toBe(true); // t = 2 min
    expect(limiter.take("a")).toBe(false);

    clock.advance(13 * MINUTE - 1); // just before the first request is 15 minutes old
    expect(limiter.take("a")).toBe(false);
    clock.advance(1); // the first one has left the window
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false); // the 1 and 2 minute ones still count
    clock.advance(MINUTE);
    expect(limiter.take("a")).toBe(true);
  });

  test("does not count refused requests, so hammering does not extend the wait", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 10 * MINUTE, now: clock.now });
    expect(takeTimes(() => limiter.take("a"), 2)).toEqual([true, true]);
    for (let minute = 0; minute < 9; minute += 1) {
      clock.advance(MINUTE);
      expect(limiter.take("a")).toBe(false);
    }
    clock.advance(MINUTE); // 10 minutes after both allowed requests
    expect(takeTimes(() => limiter.take("a"), 3)).toEqual([true, true, false]);
  });

  test("counts each address on its own", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, now: clock.now });
    expect(limiter.take("203.0.113.7")).toBe(true);
    expect(limiter.take("203.0.113.7")).toBe(false);
    expect(limiter.take("198.51.100.2")).toBe(true);
    expect(limiter.take("2001:db8::1")).toBe(true);
  });

  test("forgets addresses whose requests have all left the window", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 10 * MINUTE, now: clock.now });
    for (const key of ["a", "b", "c"]) limiter.take(key);
    expect(limiter.size()).toBe(3);
    clock.advance(10 * MINUTE);
    limiter.take("d");
    expect(limiter.size()).toBe(1);
  });

  test("keeps at most maxKeys addresses, forgetting the least recently seen", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, maxKeys: 3, now: clock.now });
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("b")).toBe(true);
    expect(limiter.take("c")).toBe(true);
    expect(limiter.take("a")).toBe(false); // seen again, so "b" is now the oldest
    expect(limiter.take("d")).toBe(true);
    expect(limiter.size()).toBe(3);
    expect(limiter.take("a")).toBe(false); // still remembered, still limited
    expect(limiter.take("c")).toBe(false);
    expect(limiter.take("b")).toBe(true); // forgotten, so it starts afresh
  });

  test("stays bounded under a flood from many addresses", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ now: clock.now });
    for (let index = 0; index < MAX_TRACKED_KEYS + 500; index += 1) {
      limiter.take(`10.0.${Math.floor(index / 256)}.${index % 256}`);
    }
    expect(limiter.size()).toBe(MAX_TRACKED_KEYS);
  });

  test("treats a clock that goes back as still inside the window", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, now: clock.now });
    expect(limiter.take("a")).toBe(true);
    clock.advance(-5 * MINUTE);
    expect(limiter.take("a")).toBe(false);
  });
});

describe("originAllowed", () => {
  // Behind nginx: Host is the public name and X-Forwarded-Proto says https.
  const live = { host: "flowdesk.upcarrera.com", proto: "https", appUrl: "https://flowdesk.upcarrera.com" };

  test("a request from this site's own pages is allowed", () => {
    expect(originAllowed("https://flowdesk.upcarrera.com", live)).toBe(true);
    expect(originAllowed("HTTPS://Flowdesk.UpCarrera.com", live)).toBe(true);
  });

  test("a request from another site is refused", () => {
    expect(originAllowed("https://evil.example", live)).toBe(false);
    expect(originAllowed("https://flowdesk.upcarrera.com.evil.example", live)).toBe(false);
    expect(originAllowed("http://flowdesk.upcarrera.com", live)).toBe(false);
    // Sandboxed frames and some redirects send the literal "null".
    expect(originAllowed("null", live)).toBe(false);
  });

  test("no Origin (a non-browser client) is left to the other limits", () => {
    expect(originAllowed(undefined, live)).toBe(true);
    expect(originAllowed("", live)).toBe(true);
  });

  test("the dev server's own address works without APP_URL", () => {
    expect(originAllowed("http://localhost:5203", { host: "localhost:5203" })).toBe(true);
    expect(originAllowed("http://localhost:3000", { host: "localhost:5203" })).toBe(false);
  });

  test("APP_URL counts even when Host is the internal address", () => {
    const internal = { host: "127.0.0.1:3100", appUrl: "https://flowdesk.upcarrera.com" };
    expect(originAllowed("https://flowdesk.upcarrera.com", internal)).toBe(true);
    expect(originAllowed("http://127.0.0.1:3100", internal)).toBe(true);
  });

  test("a list in X-Forwarded-Proto uses its first value; a bad APP_URL adds nothing", () => {
    expect(originAllowed("https://a.example", { host: "a.example", proto: "https, http" })).toBe(true);
    expect(originAllowed("https://b.example", { host: "a.example", appUrl: "not a url" })).toBe(false);
  });
});

