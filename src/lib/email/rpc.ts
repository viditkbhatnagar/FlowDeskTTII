import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../integrations/supabase/types";
import type { ClaimedEmail, EmailResult, EmailSnapshot, OutboxInsert } from "./snapshot";

/** The four secret-gated worker RPCs (supabase/migrations/20260926000000_email_notifications.sql). */
export type EmailRpc = {
  snapshot(): Promise<EmailSnapshot>;
  enqueue(rows: OutboxInsert[]): Promise<number>;
  claim(limit?: number): Promise<ClaimedEmail[]>;
  complete(results: EmailResult[]): Promise<number>;
};

export type EmailRpcOptions = {
  supabaseUrl: string;
  publishableKey: string;
  secret: string;
  fetch?: typeof fetch;
};

type RpcError = { message: string; code?: string };

const isNewApiKey = (key: string) =>
  key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");

// Same as the app's other server clients: new Supabase keys are opaque strings, not bearer
// JWTs, so they travel only as `apikey`.
function keyedFetch(key: string, base: typeof fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (isNewApiKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return base(input, { ...init, headers });
  };
}

function unwrap<T>(name: string, result: { data: unknown; error: RpcError | null }): T {
  // The error text never contains the secret: PostgREST reports the SQL error, not the arguments.
  if (result.error) {
    const code = result.error.code ? ` (${result.error.code})` : "";
    throw new Error(`${name}: ${result.error.message}${code}`);
  }
  return result.data as T;
}

export function createEmailRpc(options: EmailRpcOptions): EmailRpc {
  const client = createClient<Database>(options.supabaseUrl, options.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: keyedFetch(options.publishableKey, options.fetch ?? fetch) },
  });
  const p_secret = options.secret;

  return {
    async snapshot() {
      const result = await client.rpc("email_worker_snapshot", { p_secret });
      return unwrap<EmailSnapshot>("email_worker_snapshot", result);
    },
    async enqueue(rows) {
      if (rows.length === 0) return 0;
      const result = await client.rpc("email_worker_enqueue", {
        p_secret,
        p_rows: rows as unknown as Json,
      });
      return unwrap<number>("email_worker_enqueue", result);
    },
    async claim(limit = 50) {
      const result = await client.rpc("email_worker_claim", { p_secret, p_limit: limit });
      return unwrap<ClaimedEmail[] | null>("email_worker_claim", result) ?? [];
    },
    async complete(results) {
      if (results.length === 0) return 0;
      const result = await client.rpc("email_worker_complete", {
        p_secret,
        p_results: results as unknown as Json,
      });
      return unwrap<number>("email_worker_complete", result);
    },
  };
}
