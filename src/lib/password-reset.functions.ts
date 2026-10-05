import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { errorText, isEmailWorkerRunning, wakeEmailWorker } from "@/lib/email/worker";
import { createRateLimiter, originAllowed } from "@/lib/password-reset-limit";

// "Forgot / change password?" on /auth. Flowdesk sends its own reset email, the way it sends the
// welcome email: request_password_reset queues it with a one-time link to /reset-password, and the
// email worker in this process sends it through Microsoft Graph. Supabase Auth's reset email is
// not used: on the hosted project it is sent by Lovable's auth email hook, which we cannot change,
// and its button opened the old prototype site rather than Flowdesk.
//
// request_password_reset is gated by the email worker's secret, which only this server holds, so
// this endpoint is the only way to it. It never says whether an account exists: 'queued' and
// 'skipped' (no such login, switched off, or in no organization) both answer { ok: true }.

export type PasswordResetRequestError = "invalid_email" | "rate_limited" | "unavailable";
export type PasswordResetRequestResult =
  | { ok: true }
  | { ok: false; error: PasswordResetRequestError };

const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The database answers in milliseconds; past this it is down, and the person should hear so. */
const RPC_TIMEOUT_MS = 10_000;

// Only the shape is checked here: a malformed address resolves as invalid_email rather than
// failing the call, so the page can say what is wrong.
const inputSchema = z.object({ email: z.string() });

/** One for the process (PM2 runs a single fork): RESET_IP_LIMIT requests per client address in 15 minutes. */
const perAddress = createRateLimiter();

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data }): Promise<PasswordResetRequestResult> => requestReset(data.email));

const failed = (error: PasswordResetRequestError): PasswordResetRequestResult => ({
  ok: false,
  error,
});

/** The address as the database compares it (trimmed, lower case), or null when it cannot be one. */
function normalizedEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email) ? email : null;
}

/**
 * Who is asking. nginx sets X-Real-IP to the connecting address, replacing any the browser sent
 * (deploy/nginx/flowdesk.conf), and the server listens on loopback only, so it can be trusted.
 * Without nginx in front (vite dev) it is the socket's address.
 */
function clientAddress(): string {
  const address = getRequestHeader("x-real-ip")?.trim() || getRequestIP() || "unknown";
  return address.slice(0, 64);
}

/** Sent from one of this site's own pages (see originAllowed). */
function fromThisSite(): boolean {
  return originAllowed(getRequestHeader("origin"), {
    host: getRequestHeader("host"),
    proto: getRequestHeader("x-forwarded-proto"),
    appUrl: process.env.APP_URL,
  });
}

/** Log lines carry no email addresses (the email worker's rule too). */
const redact = (text: string) => text.replace(/[^\s"'<>(),;:]+@[^\s"'<>(),;:]+/g, "<address>");

type ServerConfig = { secret: string; supabaseUrl: string; publishableKey: string };

/** The same variables the email worker reads (src/lib/email/env.ts); null when one is missing. */
function serverConfig(): ServerConfig | null {
  const secret = process.env.EMAIL_WORKER_SECRET?.trim() ?? "";
  const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  return secret && supabaseUrl && publishableKey ? { secret, supabaseUrl, publishableKey } : null;
}

const isNewApiKey = (key: string) =>
  key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");

/**
 * A client with no session, as the email worker's (src/lib/email/rpc.ts): new Supabase keys are
 * opaque strings, not bearer JWTs, so they travel only as `apikey`.
 */
function serverClient({ supabaseUrl, publishableKey }: ServerConfig) {
  const keyedFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (
      isNewApiKey(publishableKey) &&
      headers.get("Authorization") === `Bearer ${publishableKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", publishableKey);
    return fetch(input, { ...init, headers });
  };
  return createClient<Database>(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: keyedFetch },
  });
}

type RpcOutcome = { data: unknown; error: { message: string; code?: string } | null };

async function callRequestReset(config: ServerConfig, email: string): Promise<RpcOutcome> {
  try {
    const { data, error } = await serverClient(config)
      .rpc("request_password_reset", { p_secret: config.secret, p_email: email })
      .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
    return { data, error };
  } catch (error) {
    return { data: null, error: { message: errorText(error) } };
  }
}

async function requestReset(rawEmail: string): Promise<PasswordResetRequestResult> {
  if (!fromThisSite()) return failed("unavailable");
  const email = normalizedEmail(rawEmail);
  if (!email) return failed("invalid_email");
  if (!perAddress.take(clientAddress())) return failed("rate_limited");

  // Queuing burns the person's earlier links; with nothing here to send the new one, they would
  // be left with none. Say it is unavailable instead (email switched off or misconfigured).
  if (!isEmailWorkerRunning()) {
    console.error("[password-reset] not sent: the email worker is not running in this process");
    return failed("unavailable");
  }

  const config = serverConfig();
  if (!config) {
    console.error(
      "[password-reset] not sent: EMAIL_WORKER_SECRET, SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set",
    );
    return failed("unavailable");
  }

  const { data, error } = await callRequestReset(config, email);
  // PT429: this address asked too often. Counted whether or not the account exists, so saying so
  // gives nothing away.
  if (error?.code === "PT429") return failed("rate_limited");
  if (error?.code === "22023") return failed("invalid_email");
  if (error) {
    const code = error.code ? ` (${error.code})` : "";
    console.error(
      `[password-reset] request_password_reset failed: ${redact(error.message)}${code}`,
    );
    return failed("unavailable");
  }
  if (data === "skipped") return { ok: true };
  if (data !== "queued") {
    console.error(`[password-reset] request_password_reset answered ${redact(String(data))}`);
    return failed("unavailable");
  }
  // The person is waiting at their inbox: send now, not at the worker's next tick minutes away.
  wakeEmailWorker();
  return { ok: true };
}
