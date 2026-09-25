// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EmailTransportError,
  createGraphTransport,
  createLogTransport,
  parseRetryAfter,
} from "./transport";

type Call = { url: string; init: RequestInit };

const CLIENT_SECRET = "graph-client-secret-value-never-logged";
const message = {
  to: "maya@upcarrera.test",
  toName: "Maya Chen",
  subject: "Hello",
  html: "<p>Hi</p>",
};

const tokenResponse = (token: string, expiresIn = 3600) =>
  new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), { status: 200 });

type ScriptedSend = number | { status: number; headers?: Record<string, string> };

/** A fake Graph: hands out tok-1, tok-2, … and answers sendMail from a script. */
function fakeGraph(sendStatuses: ScriptedSend[] = []) {
  const calls: Call[] = [];
  let tokens = 0;
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.includes("login.microsoftonline.com")) {
      tokens += 1;
      return tokenResponse(`tok-${tokens}`);
    }
    const next = sendStatuses.shift() ?? 202;
    const { status, headers } = typeof next === "number" ? { status: next, headers: {} } : next;
    return new Response(
      status === 202 ? null : `{"error":{"code":"E${status}","message":"nope"}}`,
      { status, headers },
    );
  };
  return {
    calls,
    fetch,
    tokenCalls: () => calls.filter((c) => c.url.includes("login.")).length,
    sendCalls: () => calls.filter((c) => c.url.endsWith("/sendMail")),
  };
}

function transport(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  clock?: () => number,
  replyTo?: string,
) {
  return createGraphTransport({
    tenantId: "tenant-1",
    clientId: "client-1",
    clientSecret: CLIENT_SECRET,
    fromAddress: "flowdesk@upcarrera.test",
    fromName: "Flowdesk",
    replyTo,
    fetch,
    clock,
  });
}

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected the send to fail");
    },
    (error: unknown) => error as EmailTransportError,
  );

const header = (call: Call, name: string) => new Headers(call.init.headers).get(name);

describe("Graph transport", () => {
  test("requests a client-credentials token, then posts sendMail as the from address", async () => {
    const graph = fakeGraph();
    await transport(graph.fetch).send(message);
    const [token, send] = graph.calls;
    expect(token.url).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
    const form = new URLSearchParams(String(token.init.body));
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("scope")).toBe("https://graph.microsoft.com/.default");
    expect(form.get("client_id")).toBe("client-1");
    expect(send.url).toBe(
      "https://graph.microsoft.com/v1.0/users/flowdesk%40upcarrera.test/sendMail",
    );
    expect(header(send, "authorization")).toBe("Bearer tok-1");
    expect(JSON.parse(String(send.init.body))).toEqual({
      message: {
        subject: "Hello",
        body: { contentType: "HTML", content: "<p>Hi</p>" },
        toRecipients: [{ emailAddress: { address: "maya@upcarrera.test", name: "Maya Chen" } }],
        from: { emailAddress: { address: "flowdesk@upcarrera.test", name: "Flowdesk" } },
      },
      saveToSentItems: false,
    });
  });

  test("sets Reply-To when one is configured, and only then", async () => {
    const graph = fakeGraph();
    await transport(graph.fetch, undefined, "hello@upcarrera.test").send(message);
    const body = JSON.parse(String(graph.calls[1].init.body));
    expect(body.message.replyTo).toEqual([{ emailAddress: { address: "hello@upcarrera.test" } }]);
    expect(body.message.from).toEqual({
      emailAddress: { address: "flowdesk@upcarrera.test", name: "Flowdesk" },
    });
    const plain = fakeGraph();
    await transport(plain.fetch).send(message);
    expect("replyTo" in JSON.parse(String(plain.calls[1].init.body)).message).toBe(false);
  });

  test("omits the recipient name when there is none", async () => {
    const graph = fakeGraph();
    await transport(graph.fetch).send({ ...message, toName: undefined });
    const body = JSON.parse(String(graph.calls[1].init.body));
    expect(body.message.toRecipients).toEqual([
      { emailAddress: { address: "maya@upcarrera.test" } },
    ]);
  });

  test("caches the token until a minute before it expires", async () => {
    const graph = fakeGraph();
    let now = 1_000_000;
    const mailer = transport(graph.fetch, () => now);
    await mailer.send(message);
    await mailer.send(message);
    expect(graph.tokenCalls()).toBe(1);
    now += 3600_000 - 60_000 - 1;
    await mailer.send(message);
    expect(graph.tokenCalls()).toBe(1);
    now += 1;
    await mailer.send(message);
    expect(graph.tokenCalls()).toBe(2);
    expect(header(graph.calls.at(-1)!, "authorization")).toBe("Bearer tok-2");
  });

  test("a 401 (stale token) is retried once with a fresh token, sending the same message", async () => {
    const graph = fakeGraph([401, 202]);
    await transport(graph.fetch).send(message);
    expect(graph.tokenCalls()).toBe(2);
    const [first, second] = graph.sendCalls();
    expect(header(first, "authorization")).toBe("Bearer tok-1");
    expect(header(second, "authorization")).toBe("Bearer tok-2");
    expect(second.init.body).toBe(first.init.body);
  });

  test("a second 401 surfaces as a sendMail error and the next send starts with a fresh token", async () => {
    const graph = fakeGraph([401, 401, 202]);
    const mailer = transport(graph.fetch);
    const error = await failureOf(mailer.send(message));
    expect(error).toBeInstanceOf(EmailTransportError);
    expect(error.message).toStartWith("Graph sendMail 401:");
    expect({ stage: error.stage, status: error.status }).toEqual({
      stage: "sendMail",
      status: 401,
    });
    await mailer.send(message);
    expect(graph.tokenCalls()).toBe(3);
    expect(header(graph.calls.at(-1)!, "authorization")).toBe("Bearer tok-3");
  });

  test("other failures surface with stage, status and a short body, keeping the token", async () => {
    const graph = fakeGraph([503]);
    const mailer = transport(graph.fetch);
    const error = await failureOf(mailer.send(message));
    expect(error).toBeInstanceOf(EmailTransportError);
    expect(error.message).toContain("Graph sendMail 503");
    expect(error.message).toContain("E503");
    expect(error.status).toBe(503);
    expect(error.stage).toBe("sendMail");
    expect(error.retryAfterSeconds).toBeUndefined();
    await mailer.send(message);
    expect(graph.tokenCalls()).toBe(1);
  });

  test("a 429 carries Graph's Retry-After, in seconds or as an HTTP date", async () => {
    const now = Date.parse("2026-09-25T04:30:00Z");
    const graph = fakeGraph([
      { status: 429, headers: { "Retry-After": "37" } },
      { status: 503, headers: { "Retry-After": "Fri, 25 Sep 2026 04:32:00 GMT" } },
    ]);
    const mailer = transport(graph.fetch, () => now);
    const throttled = await failureOf(mailer.send(message));
    expect({ status: throttled.status, retryAfterSeconds: throttled.retryAfterSeconds }).toEqual({
      status: 429,
      retryAfterSeconds: 37,
    });
    expect((await failureOf(mailer.send(message))).retryAfterSeconds).toBe(120);
  });

  test("parseRetryAfter reads delta-seconds and dates, and ignores anything else", () => {
    const now = Date.parse("2026-09-25T04:30:00Z");
    expect(parseRetryAfter("0", now)).toBe(0);
    expect(parseRetryAfter(" 60 ", now)).toBe(60);
    expect(parseRetryAfter("Fri, 25 Sep 2026 04:30:30 GMT", now)).toBe(30);
    expect(parseRetryAfter("Fri, 25 Sep 2026 04:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter("", now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  test("a long error body is truncated", async () => {
    const fetch = async (url: string) =>
      url.includes("login.") ? tokenResponse("t") : new Response("x".repeat(5000), { status: 500 });
    const error = (await transport(fetch)
      .send(message)
      .catch((e: Error) => e)) as Error;
    expect(error.message.length).toBeLessThan(400);
  });

  test("token endpoint failures surface as the token stage, without the client secret", async () => {
    const fetch = async () => new Response(`{"error":"invalid_client"}`, { status: 401 });
    const error = await failureOf(transport(fetch).send(message));
    expect(error.message).toContain("Graph token endpoint 401");
    expect(error.message).toContain("invalid_client");
    expect(error.message).not.toContain(CLIENT_SECRET);
    expect({ stage: error.stage, status: error.status }).toEqual({ stage: "token", status: 401 });
  });

  test("a token response without access_token is a token-stage error", async () => {
    const fetch = async () => new Response("{}", { status: 200 });
    const error = await failureOf(transport(fetch).send(message));
    expect(error.message).toContain("no access_token");
    expect(error.stage).toBe("token");
  });

  test("a network failure surfaces with its stage and no status", async () => {
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    const token = await failureOf(transport(down).send(message));
    expect(token.message).toBe("Graph token endpoint request failed: fetch failed");
    expect({ stage: token.stage, status: token.status }).toEqual({
      stage: "token",
      status: undefined,
    });
    const sendDown = async (url: string) => {
      if (url.includes("login.")) return tokenResponse("t");
      throw new TypeError("fetch failed");
    };
    const send = await failureOf(transport(sendDown).send(message));
    expect(send.message).toBe("Graph sendMail request failed: fetch failed");
    expect(send.stage).toBe("sendMail");
    expect(send.status).toBeUndefined();
  });
});

describe("log transport", () => {
  test("writes one HTML file per email, never overwriting, and logs a line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flowdesk-email-"));
    const lines: string[] = [];
    try {
      const mailer = createLogTransport(join(dir, "nested"), (line) => lines.push(line));
      expect(mailer.name).toBe("log");
      await mailer.send({ ...message, subject: "First -- of <b>two</b>" });
      await mailer.send(message);
      const files = readdirSync(join(dir, "nested")).sort();
      expect(files).toHaveLength(2);
      expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-0001-maya@upcarrera\.test\.html$/);
      const first = readFileSync(join(dir, "nested", files[0]), "utf8");
      expect(first.split("\n")[0]).toBe(
        "<!-- To: Maya Chen (maya@upcarrera.test) | Subject: First - of &lt;b&gt;two&lt;/b&gt; -->",
      );
      expect(first).toContain("<p>Hi</p>");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("maya@upcarrera.test");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
