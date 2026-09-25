import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type OutgoingEmail = { to: string; toName?: string; subject: string; html: string };

export type EmailTransport = {
  name: "graph" | "log";
  send(message: OutgoingEmail): Promise<void>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type GraphTransportOptions = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fromAddress: string;
  fromName: string;
  /** Where replies go, when not to the sending mailbox. */
  replyTo?: string;
  fetch?: FetchLike;
  /** Defaults to Date.now; injectable so token expiry can be tested. */
  clock?: () => number;
};

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_SCOPE = "https://graph.microsoft.com/.default";
// Refresh slightly before the real expiry to avoid edge-of-expiry failures.
const TOKEN_SKEW_MS = 60_000;
const DEFAULT_TOKEN_TTL_S = 3600;
// A hung request would hold the worker's single tick open forever.
const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_BODY_CHARS = 300;

/** Which Graph call failed: getting a token, or sending the message itself. */
export type TransportStage = "token" | "sendMail";

type TransportErrorDetails = {
  stage: TransportStage;
  /** The HTTP status; absent when no response arrived (network failure or timeout). */
  status?: number;
  /** Graph's Retry-After, in seconds, when it sent one. */
  retryAfterSeconds?: number;
};

export class EmailTransportError extends Error {
  readonly stage: TransportStage;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(message: string, details: TransportErrorDetails) {
    super(message);
    this.name = "EmailTransportError";
    this.stage = details.stage;
    this.status = details.status;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

/** Retry-After as delta-seconds or an HTTP date; undefined when absent or unreadable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  const text = value?.trim() ?? "";
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text);
  const at = Date.parse(text);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - nowMs) / 1000));
}

async function shortBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.replace(/\s+/g, " ").trim().slice(0, ERROR_BODY_CHARS);
}

const causeText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Microsoft Graph sendMail with app-only client credentials: a port of the CRM's
 * EmailService (upcarrera-v2 apps/api/src/integrations/email.service.ts), same tenant
 * app and flow. Tokens are cached in memory until a minute before they expire.
 */
export function createGraphTransport(options: GraphTransportOptions): EmailTransport {
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const clock = options.clock ?? Date.now;
  let cachedToken: string | null = null;
  let tokenExpiresAt = 0;

  const forgetToken = () => {
    cachedToken = null;
    tokenExpiresAt = 0;
  };

  async function request(stage: TransportStage, label: string, url: string, init: RequestInit) {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      throw new EmailTransportError(`${label} request failed: ${causeText(error)}`, { stage });
    }
  }

  async function failure(stage: TransportStage, label: string, response: Response) {
    return new EmailTransportError(`${label} ${response.status}: ${await shortBody(response)}`, {
      stage,
      status: response.status,
      retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after"), clock()),
    });
  }

  async function accessToken(): Promise<string> {
    const now = clock();
    if (cachedToken && now < tokenExpiresAt) return cachedToken;
    const label = "Graph token endpoint";
    const response = await request(
      "token",
      label,
      `https://login.microsoftonline.com/${encodeURIComponent(options.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          scope: TOKEN_SCOPE,
          grant_type: "client_credentials",
        }).toString(),
      },
    );
    if (!response.ok) throw await failure("token", label, response);
    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new EmailTransportError(`${label} returned no access_token`, {
        stage: "token",
        status: response.status,
      });
    }
    cachedToken = data.access_token;
    tokenExpiresAt =
      now + Math.max(0, (data.expires_in ?? DEFAULT_TOKEN_TTL_S) * 1000 - TOKEN_SKEW_MS);
    return cachedToken;
  }

  const sendMailUrl = `${GRAPH_BASE}/users/${encodeURIComponent(options.fromAddress)}/sendMail`;

  function messageBody(message: OutgoingEmail): string {
    return JSON.stringify({
      message: {
        subject: message.subject,
        body: { contentType: "HTML", content: message.html },
        toRecipients: [
          {
            emailAddress: {
              address: message.to,
              ...(message.toName ? { name: message.toName } : {}),
            },
          },
        ],
        from: { emailAddress: { address: options.fromAddress, name: options.fromName } },
        ...(options.replyTo ? { replyTo: [{ emailAddress: { address: options.replyTo } }] } : {}),
      },
      saveToSentItems: false,
    });
  }

  const postSendMail = async (body: string) =>
    request("sendMail", "Graph sendMail", sendMailUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        "content-type": "application/json",
      },
      body,
    });

  async function send(message: OutgoingEmail): Promise<void> {
    const body = messageBody(message);
    let response = await postSendMail(body);
    if (response.status === 401) {
      // A revoked or rotated token. Graph did not take the message, so one more try with a fresh
      // token cannot send it twice; a second 401 is a real permission problem.
      await response.text().catch(() => "");
      forgetToken();
      response = await postSendMail(body);
      if (response.status === 401) forgetToken();
    }
    // Graph answers 202 Accepted with an empty body.
    if (response.ok) return;
    throw await failure("sendMail", "Graph sendMail", response);
  }

  return { name: "graph", send };
}

const safeFilePart = (value: string) => value.replace(/[^a-zA-Z0-9@._-]+/g, "_").slice(0, 80);

// "--" would end the HTML comment early; angle brackets keep a hostile subject inert even
// to a careless viewer of the file.
const commentSafe = (value: string) =>
  value.replace(/-{2,}/g, "-").replace(/\s+/g, " ").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * Development transport: writes each email to `dir` as an HTML file instead of sending it.
 * A sequence number keeps two emails to one person in the same millisecond apart.
 */
export function createLogTransport(
  dir: string,
  log: (line: string) => void = (line) => console.info(line),
): EmailTransport {
  let sequence = 0;
  return {
    name: "log",
    async send(message) {
      sequence += 1;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const name = `${stamp}-${String(sequence).padStart(4, "0")}-${safeFilePart(message.to)}.html`;
      const file = join(dir, name);
      const to = message.toName ? `${message.toName} (${message.to})` : message.to;
      const header = `<!-- To: ${commentSafe(to)} | Subject: ${commentSafe(message.subject)} -->`;
      await mkdir(dir, { recursive: true });
      await writeFile(file, `${header}\n${message.html}`, "utf8");
      log(`[email] log transport wrote ${file} (to ${message.to}: "${message.subject}")`);
    },
  };
}
