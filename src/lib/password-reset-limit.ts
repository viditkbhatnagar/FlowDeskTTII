// A small in-memory limit on "Forgot password?" requests per client address, checked by the
// server function (src/lib/password-reset.functions.ts) before it asks the database for anything.
//
// The database keeps its own limits, per email address and across everyone (request_password_reset).
// This one stops a single machine from spending that shared allowance, which would block everyone
// else's resets, and it costs no round trip. It lives in the one Node process (PM2 runs a single
// fork), so a restart forgets it, which is fine for a limit counted in minutes.

/**
 * At most this many requests from one address in RESET_IP_WINDOW_MS. Generous on purpose: an
 * office shares one public address, and the database still allows only 5 per email an hour.
 */
export const RESET_IP_LIMIT = 20;
export const RESET_IP_WINDOW_MS = 15 * 60_000;
/** Beyond this many addresses, the least recently seen are forgotten, so memory stays bounded. */
export const MAX_TRACKED_KEYS = 10_000;

export type RateLimiter = {
  /** Counts one request for the key; false, counting nothing, when the key is at its limit. */
  take(key: string): boolean;
  /** How many keys it remembers right now. */
  size(): number;
};

export type RateLimiterOptions = {
  limit?: number;
  windowMs?: number;
  maxKeys?: number;
  /** Milliseconds since the epoch; replaces the real clock in tests. */
  now?: () => number;
};

/**
 * A sliding window per key: a request is allowed while fewer than `limit` were allowed in the
 * last `windowMs`. A refused request is not counted, so someone who keeps trying gets in again
 * once their oldest request leaves the window.
 */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const limit = options.limit ?? RESET_IP_LIMIT;
  const windowMs = options.windowMs ?? RESET_IP_WINDOW_MS;
  const maxKeys = options.maxKeys ?? MAX_TRACKED_KEYS;
  const now = options.now ?? Date.now;
  // The times of each key's allowed requests. Every request moves its key to the end of the map
  // (a Map keeps insertion order), so the first keys are the ones seen least recently. A key that
  // is refused moves too: someone hammering the form must not be the first to be forgotten.
  const seen = new Map<string, readonly number[]>();
  let lastSweep = now();

  const inWindow = (times: readonly number[], at: number) =>
    times.filter((time) => at - time < windowMs);

  const sweep = (at: number) => {
    // Keys with nothing left in the window, at most once a window so it stays cheap.
    if (at - lastSweep >= windowMs) {
      lastSweep = at;
      for (const [key, times] of seen) {
        if (inWindow(times, at).length === 0) seen.delete(key);
      }
    }
    // A flood from more addresses than the cap: forget the least recently seen.
    for (const key of seen.keys()) {
      if (seen.size <= maxKeys) break;
      seen.delete(key);
    }
  };

  return {
    take(key) {
      const at = now();
      const times = inWindow(seen.get(key) ?? [], at);
      const allowed = times.length < limit;
      seen.delete(key);
      seen.set(key, allowed ? [...times, at] : times);
      sweep(at);
      return allowed;
    },
    size: () => seen.size,
  };
}

/**
 * Whether a request may come from where it says it comes from. A browser names the page that sent
 * a POST in Origin; one from another site is refused, so a page elsewhere cannot spend its
 * visitors' network addresses on this site's reset limits (a plain cross-site form post reaches a
 * server function without any CORS check). No Origin at all is a non-browser client, which could
 * claim any Origin anyway; the per-address limits still apply to it.
 */
export function originAllowed(
  origin: string | undefined,
  own: { host?: string; proto?: string; appUrl?: string },
): boolean {
  if (origin === undefined || origin === "") return true;
  const allowed = new Set<string>();
  if (own.host) allowed.add(`${(own.proto || "http").split(",")[0].trim()}://${own.host}`.toLowerCase());
  if (own.appUrl) {
    try {
      allowed.add(new URL(own.appUrl).origin.toLowerCase());
    } catch {
      // A malformed APP_URL allows nothing extra.
    }
  }
  return allowed.has(origin.trim().toLowerCase());
}

