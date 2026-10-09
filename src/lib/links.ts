/**
 * Links kept next to uploaded files — a SharePoint, OneDrive or Google document
 * that people edit in place instead of downloading and re-sharing a copy
 * (Sharon, 9 Oct 2026).
 *
 * The database is the real guard: task_attachments and project_documents only
 * accept a link_url matching ^https?://[^[:space:][:cntrl:]]+$ of at most 2048
 * characters, and a file_name of 1–255 characters. These helpers refuse the
 * same things earlier, with a sentence a person can act on, and decide what is
 * safe to put in an href when a link is shown.
 *
 * Pure functions with no Supabase import, so they can be unit tested.
 */

export const LINK_RULES = {
  maxUrlLength: 2048,
  maxNameLength: 255,
} as const;

/** A link ready to be saved: an http(s) URL and the name it is listed under. */
export interface LinkInput {
  url: string;
  name: string;
}

export interface LinkFieldErrors {
  url?: string;
  name?: string;
}

export type ParsedLink = { ok: true; link: LinkInput } | { ok: false; errors: LinkFieldErrors };

export type NormalizedUrl = { ok: true; url: string } | { ok: false; error: string };

/**
 * Whitespace, control characters and invisible format characters (zero-width
 * spaces, right-to-left overrides). The database refuses the first two; the
 * third is refused here because it disguises where a link really goes.
 */
const UNSAFE_URL_CHARACTERS = /[\s\p{Cc}\p{Cf}]/u;
/** "http://" or "https://" followed by a host, not by another slash. */
const WEB_LINK_START = /^https?:\/\/[^/\\]/i;
/** A leading "scheme:"; one with a dot in it is really "host:port". */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

const MESSAGES = {
  empty: "Paste or type a link.",
  spaces:
    "A link cannot contain spaces. Copy it again from the browser's address bar or the Share button.",
  scheme: "Only web links (http:// or https://) can be added.",
  invalid: "This does not look like a web link. Check it and try again.",
  credentials: "Links with a user name or password in them cannot be added.",
  urlTooLong: `Links can be at most ${LINK_RULES.maxUrlLength} characters.`,
  nameTooLong: `Names can be at most ${LINK_RULES.maxNameLength} characters.`,
} as const;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * The value itself when it is safe to use as an href — an absolute http(s)
 * link with a host and no spaces or control characters — otherwise null.
 * Refuses javascript:, data:, any other scheme, and relative links.
 */
export function safeHref(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !WEB_LINK_START.test(value)) return null;
  if (UNSAFE_URL_CHARACTERS.test(value)) return null;
  const url = parseUrl(value);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    return null;
  }
  return value;
}

/** "upcarrera.sharepoint.com" for a SharePoint link; "" when it cannot be read. */
export function linkHostname(value: string): string {
  return parseUrl(value)?.hostname ?? "";
}

/** What a link is called when nobody named it: its hostname. */
export function defaultLinkName(url: string): string {
  return linkHostname(url) || "Link";
}

/**
 * Turn whatever was pasted into the link that gets saved, or say why not.
 * Keeps the link as pasted (so SharePoint links survive untouched) apart from
 * trimming it, lower-casing the scheme — the database check is case-sensitive —
 * and adding https:// when there is no scheme at all.
 */
export function normalizeLinkUrl(raw: string): NormalizedUrl {
  const text = raw.trim();
  if (!text) return { ok: false, error: MESSAGES.empty };
  if (UNSAFE_URL_CHARACTERS.test(text)) return { ok: false, error: MESSAGES.spaces };

  const scheme = SCHEME.exec(text)?.[1];
  const typedScheme = Boolean(scheme && !scheme.includes("."));
  let url: string;
  if (scheme && typedScheme) {
    if (!/^https?$/i.test(scheme)) return { ok: false, error: MESSAGES.scheme };
    url = scheme.toLowerCase() + text.slice(scheme.length);
  } else {
    url = text.startsWith("//") ? `https:${text}` : `https://${text}`;
  }

  if (url.length > LINK_RULES.maxUrlLength) return { ok: false, error: MESSAGES.urlTooLong };
  const parsed = WEB_LINK_START.test(url) ? parseUrl(url) : null;
  // Without a typed scheme, "Budget" is a name pasted into the wrong box, not
  // a host on the intranet; a typed http://intranet is taken at its word.
  if (!parsed?.hostname || (!typedScheme && !parsed.hostname.includes("."))) {
    return { ok: false, error: MESSAGES.invalid };
  }
  if (parsed.username || parsed.password) return { ok: false, error: MESSAGES.credentials };
  return { ok: true, url };
}

/** Line breaks and tabs become single spaces; the ends are trimmed. */
const cleanName = (value: string) => value.replace(/[\s\p{Cc}]+/gu, " ").trim();

/** Characters, as Postgres counts them — not UTF-16 units. */
const characterCount = (value: string) => Array.from(value).length;

/**
 * Check the Add link form. Each field reports its own problem; the name is
 * optional and defaults to the link's hostname.
 */
export function parseLinkInput(input: { url: string; name?: string | null }): ParsedLink {
  const errors: LinkFieldErrors = {};
  const url = normalizeLinkUrl(input.url);
  if (!url.ok) errors.url = url.error;
  const name = cleanName(input.name ?? "");
  if (characterCount(name) > LINK_RULES.maxNameLength) errors.name = MESSAGES.nameTooLong;
  if (!url.ok || errors.name) return { ok: false, errors };
  return { ok: true, link: { url: url.url, name: name || defaultLinkName(url.url) } };
}
