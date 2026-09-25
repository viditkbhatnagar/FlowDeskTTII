// Email worker configuration from the environment. Never throws: a disabled or
// misconfigured worker is reported once by the caller, and the web server carries on.

export const DEFAULT_APP_URL = "https://flowdesk.upcarrera.com";
export const DEFAULT_INTERVAL_MS = 300_000;
export const MIN_INTERVAL_MS = 60_000;
export const MIN_SECRET_LENGTH = 32;
const DEFAULT_FROM_NAME = "Flowdesk";

export type GraphTransportConfig = {
  kind: "graph";
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fromAddress: string;
  fromName: string;
  replyTo?: string;
};
export type LogTransportConfig = { kind: "log"; dir: string };

export type EmailWorkerConfig = {
  secret: string;
  transport: GraphTransportConfig | LogTransportConfig;
  appUrl: string;
  intervalMs: number;
  supabaseUrl: string;
  supabasePublishableKey: string;
};

export type EmailEnvResult =
  | { ok: true; config: EmailWorkerConfig }
  /** misconfigured: switched on, but a setting is missing or wrong (worth an error line). */
  | { ok: false; reason: string; misconfigured: boolean };

type Env = Record<string, string | undefined>;

const read = (env: Env, name: string) => env[name]?.trim() ?? "";

// Graph rejects every message with a malformed Reply-To, so a typo must stop the worker at boot
// rather than fail each email as a bad recipient.
const EMAIL_ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function readLogTransport(env: Env): LogTransportConfig | string {
  const production = read(env, "NODE_ENV").toLowerCase() === "production";
  if (production && read(env, "EMAIL_LOG_ALLOW_PRODUCTION").toLowerCase() !== "true") {
    return (
      "EMAIL_TRANSPORT=log is refused with NODE_ENV=production: it marks every email it writes " +
      "as sent in the database it points at, so real recipients would never get them. " +
      "Leave EMAIL_WORKER_ENABLED unset until the Graph settings are in, or set " +
      "EMAIL_LOG_ALLOW_PRODUCTION=true when this server points at a local database"
    );
  }
  const dir = read(env, "EMAIL_LOG_DIR");
  return dir ? { kind: "log", dir } : "EMAIL_TRANSPORT=log needs EMAIL_LOG_DIR";
}

function readTransport(env: Env): GraphTransportConfig | LogTransportConfig | string {
  const requested = read(env, "EMAIL_TRANSPORT").toLowerCase();
  const graph = {
    tenantId: read(env, "MS_TENANT_ID"),
    clientId: read(env, "MS_CLIENT_ID"),
    clientSecret: read(env, "MS_CLIENT_SECRET"),
    fromAddress: read(env, "MAIL_FROM_ADDRESS"),
  };
  const missingGraph = Object.entries({
    MS_TENANT_ID: graph.tenantId,
    MS_CLIENT_ID: graph.clientId,
    MS_CLIENT_SECRET: graph.clientSecret,
    MAIL_FROM_ADDRESS: graph.fromAddress,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (requested === "log") return readLogTransport(env);
  if (requested && requested !== "graph") {
    return `EMAIL_TRANSPORT must be "graph" or "log", got "${requested}"`;
  }
  if (missingGraph.length > 0) {
    return requested
      ? `EMAIL_TRANSPORT=graph but ${missingGraph.join(", ")} not set`
      : `no transport: set EMAIL_TRANSPORT=log, or ${missingGraph.join(", ")} for Microsoft Graph`;
  }
  const replyTo = read(env, "MAIL_REPLY_TO");
  if (replyTo && !EMAIL_ADDRESS.test(replyTo)) {
    return `MAIL_REPLY_TO must be a single email address, got "${replyTo}"`;
  }
  return {
    kind: "graph",
    ...graph,
    fromName: read(env, "MAIL_FROM_NAME") || DEFAULT_FROM_NAME,
    ...(replyTo ? { replyTo } : {}),
  };
}

function readAppUrl(env: Env): string | null {
  const value = (read(env, "APP_URL") || DEFAULT_APP_URL).replace(/\/+$/, "");
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function readInterval(env: Env): number {
  const value = Number(read(env, "EMAIL_WORKER_INTERVAL_MS"));
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.round(value));
}

const refuse = (reason: string): EmailEnvResult => ({ ok: false, reason, misconfigured: true });

export function readEmailEnv(env: Env = process.env): EmailEnvResult {
  if (read(env, "EMAIL_WORKER_ENABLED").toLowerCase() !== "true") {
    return { ok: false, reason: 'EMAIL_WORKER_ENABLED is not "true"', misconfigured: false };
  }
  const secret = read(env, "EMAIL_WORKER_SECRET");
  if (secret.length < MIN_SECRET_LENGTH) {
    return refuse(`EMAIL_WORKER_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  const supabaseUrl = read(env, "SUPABASE_URL");
  const supabasePublishableKey = read(env, "SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !supabasePublishableKey) {
    return refuse("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set");
  }
  const transport = readTransport(env);
  if (typeof transport === "string") return refuse(transport);
  const appUrl = readAppUrl(env);
  if (!appUrl) return refuse("APP_URL must be an http(s) URL");
  return {
    ok: true,
    config: {
      secret,
      transport,
      appUrl,
      intervalMs: readInterval(env),
      supabaseUrl,
      supabasePublishableKey,
    },
  };
}

/** One line for the startup log; carries no secret. */
export function describeConfig(config: EmailWorkerConfig): string {
  const { transport: t } = config;
  const replyTo = t.kind === "graph" && t.replyTo ? ` (reply-to ${t.replyTo})` : "";
  const transport = t.kind === "graph" ? `graph as ${t.fromAddress}${replyTo}` : `log to ${t.dir}`;
  return `transport=${transport}, app=${config.appUrl}, every ${Math.round(config.intervalMs / 1000)}s`;
}
