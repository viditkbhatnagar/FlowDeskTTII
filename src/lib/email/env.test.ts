// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import { DEFAULT_INTERVAL_MS, describeConfig, readEmailEnv, type EmailEnvResult } from "./env";

const SECRET = "s".repeat(40);
const BASE = {
  EMAIL_WORKER_ENABLED: "true",
  EMAIL_WORKER_SECRET: SECRET,
  SUPABASE_URL: "http://127.0.0.1:54421",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local",
  EMAIL_TRANSPORT: "log",
  EMAIL_LOG_DIR: "/tmp/flowdesk-email",
};
const GRAPH = {
  MS_TENANT_ID: "tenant",
  MS_CLIENT_ID: "client",
  MS_CLIENT_SECRET: "graph-secret",
  MAIL_FROM_ADDRESS: "flowdesk@upcarrera.com",
};

function config(result: EmailEnvResult) {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.config;
}

function reason(result: EmailEnvResult) {
  if (result.ok) throw new Error("expected a disabled worker");
  return result.reason;
}

describe("readEmailEnv", () => {
  test("is off unless EMAIL_WORKER_ENABLED is exactly true", () => {
    expect(reason(readEmailEnv({}))).toBe('EMAIL_WORKER_ENABLED is not "true"');
    expect(readEmailEnv({ ...BASE, EMAIL_WORKER_ENABLED: "1" }).ok).toBe(false);
    expect(readEmailEnv({ ...BASE, EMAIL_WORKER_ENABLED: "TRUE" }).ok).toBe(true);
  });

  test("needs a secret of at least 32 characters", () => {
    expect(reason(readEmailEnv({ ...BASE, EMAIL_WORKER_SECRET: "short" }))).toContain(
      "at least 32",
    );
    expect(readEmailEnv({ ...BASE, EMAIL_WORKER_SECRET: "x".repeat(32) }).ok).toBe(true);
  });

  test("needs the Supabase URL and publishable key", () => {
    expect(reason(readEmailEnv({ ...BASE, SUPABASE_URL: "" }))).toContain("SUPABASE_URL");
    expect(reason(readEmailEnv({ ...BASE, SUPABASE_PUBLISHABLE_KEY: undefined }))).toContain(
      "SUPABASE_PUBLISHABLE_KEY",
    );
  });

  test("log transport needs a directory", () => {
    expect(config(readEmailEnv(BASE)).transport).toEqual({
      kind: "log",
      dir: "/tmp/flowdesk-email",
    });
    expect(reason(readEmailEnv({ ...BASE, EMAIL_LOG_DIR: "" }))).toBe(
      "EMAIL_TRANSPORT=log needs EMAIL_LOG_DIR",
    );
  });

  test("defaults to Graph when every Microsoft setting is present, else stays off", () => {
    const { EMAIL_TRANSPORT: _t, EMAIL_LOG_DIR: _d, ...noTransport } = BASE;
    expect(config(readEmailEnv({ ...noTransport, ...GRAPH })).transport).toEqual({
      kind: "graph",
      tenantId: "tenant",
      clientId: "client",
      clientSecret: "graph-secret",
      fromAddress: "flowdesk@upcarrera.com",
      fromName: "Flowdesk",
    });
    expect(reason(readEmailEnv(noTransport))).toContain("no transport");
    expect(reason(readEmailEnv({ ...noTransport, ...GRAPH, MAIL_FROM_ADDRESS: "" }))).toContain(
      "MAIL_FROM_ADDRESS",
    );
  });

  test("an explicit graph transport lists what is missing", () => {
    expect(reason(readEmailEnv({ ...BASE, EMAIL_TRANSPORT: "graph", MS_TENANT_ID: "t" }))).toBe(
      "EMAIL_TRANSPORT=graph but MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_FROM_ADDRESS not set",
    );
    expect(
      config(readEmailEnv({ ...BASE, ...GRAPH, EMAIL_TRANSPORT: "graph", MAIL_FROM_NAME: "Ops" }))
        .transport,
    ).toMatchObject({
      kind: "graph",
      fromName: "Ops",
    });
  });

  test("the log transport is refused with NODE_ENV=production: it would mark real email sent", () => {
    const refused = readEmailEnv({ ...BASE, NODE_ENV: "production" });
    expect(refused).toMatchObject({ ok: false, misconfigured: true });
    expect(reason(refused)).toStartWith(
      "EMAIL_TRANSPORT=log is refused with NODE_ENV=production: it marks every email it writes as sent",
    );
    expect(reason(refused)).toContain("EMAIL_LOG_ALLOW_PRODUCTION=true");
    expect(reason(readEmailEnv({ ...BASE, NODE_ENV: " Production " }))).toContain("refused");
    expect(
      readEmailEnv({ ...BASE, NODE_ENV: "production", EMAIL_LOG_ALLOW_PRODUCTION: "yes" }).ok,
    ).toBe(false);
    const allowed = readEmailEnv({
      ...BASE,
      NODE_ENV: "production",
      EMAIL_LOG_ALLOW_PRODUCTION: "true",
    });
    expect(config(allowed).transport).toEqual({ kind: "log", dir: "/tmp/flowdesk-email" });
    expect(readEmailEnv({ ...BASE, NODE_ENV: "development" }).ok).toBe(true);
    expect(
      config(readEmailEnv({ ...BASE, ...GRAPH, EMAIL_TRANSPORT: "graph", NODE_ENV: "production" }))
        .transport.kind,
    ).toBe("graph");
  });

  test("MAIL_REPLY_TO is optional, and must be one address when set", () => {
    const graphOnly = { ...BASE, ...GRAPH, EMAIL_TRANSPORT: "graph" };
    expect("replyTo" in config(readEmailEnv(graphOnly)).transport).toBe(false);
    expect(
      config(readEmailEnv({ ...graphOnly, MAIL_REPLY_TO: " hello@upcarrera.com " })).transport,
    ).toMatchObject({
      kind: "graph",
      fromAddress: "flowdesk@upcarrera.com",
      replyTo: "hello@upcarrera.com",
    });
    for (const bad of ["hello", "a@b.com, c@d.com", "Hello <hello@upcarrera.com>"]) {
      expect(reason(readEmailEnv({ ...graphOnly, MAIL_REPLY_TO: bad }))).toContain("MAIL_REPLY_TO");
    }
  });

  test("switched off is not a misconfiguration; a bad setting is", () => {
    expect(readEmailEnv({})).toMatchObject({ ok: false, misconfigured: false });
    expect(readEmailEnv({ ...BASE, EMAIL_WORKER_SECRET: "" })).toMatchObject({
      ok: false,
      misconfigured: true,
    });
  });

  test("rejects an unknown transport", () => {
    expect(reason(readEmailEnv({ ...BASE, EMAIL_TRANSPORT: "smtp" }))).toContain('got "smtp"');
  });

  test("APP_URL defaults to production and loses any trailing slash", () => {
    expect(config(readEmailEnv(BASE)).appUrl).toBe("https://flowdesk.upcarrera.com");
    expect(config(readEmailEnv({ ...BASE, APP_URL: "http://127.0.0.1:3197///" })).appUrl).toBe(
      "http://127.0.0.1:3197",
    );
    expect(reason(readEmailEnv({ ...BASE, APP_URL: "javascript:alert(1)" }))).toContain("APP_URL");
    expect(reason(readEmailEnv({ ...BASE, APP_URL: "not a url" }))).toContain("APP_URL");
  });

  test("interval defaults to five minutes and never drops below one", () => {
    expect(config(readEmailEnv(BASE)).intervalMs).toBe(DEFAULT_INTERVAL_MS);
    expect(config(readEmailEnv({ ...BASE, EMAIL_WORKER_INTERVAL_MS: "1000" })).intervalMs).toBe(
      60_000,
    );
    expect(config(readEmailEnv({ ...BASE, EMAIL_WORKER_INTERVAL_MS: "120000" })).intervalMs).toBe(
      120_000,
    );
    expect(config(readEmailEnv({ ...BASE, EMAIL_WORKER_INTERVAL_MS: "soon" })).intervalMs).toBe(
      DEFAULT_INTERVAL_MS,
    );
  });

  test("the startup description never contains a secret", () => {
    const graph = describeConfig(
      config(readEmailEnv({ ...BASE, ...GRAPH, EMAIL_TRANSPORT: "graph" })),
    );
    expect(graph).toContain("graph as flowdesk@upcarrera.com");
    expect(
      describeConfig(
        config(
          readEmailEnv({
            ...BASE,
            ...GRAPH,
            EMAIL_TRANSPORT: "graph",
            MAIL_REPLY_TO: "hello@upcarrera.com",
          }),
        ),
      ),
    ).toContain("graph as flowdesk@upcarrera.com (reply-to hello@upcarrera.com)");
    expect(graph).not.toContain("graph-secret");
    expect(graph).not.toContain(SECRET);
    expect(describeConfig(config(readEmailEnv(BASE)))).toBe(
      "transport=log to /tmp/flowdesk-email, app=https://flowdesk.upcarrera.com, every 300s",
    );
  });
});
