import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// http(s) links and bare www. links. Anything else (javascript:, data:, …) is
// never turned into a link, so a description cannot smuggle in a script URL.
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
// Punctuation that ends a sentence rather than the link: "see https://x.com."
const TRAILING = /[.,;:!?'"\]}>]+$/;

function splitTrailing(raw: string): [string, string] {
  let url = raw.replace(TRAILING, "");
  // Keep a closing parenthesis only when the link opened one, e.g. a Wikipedia URL.
  while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(TRAILING, "");
  }
  return [url, raw.slice(url.length)];
}

/** Text with URLs turned into links, built as React elements (no innerHTML). */
function linkify(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const [url, rest] = splitTrailing(match[0]);
    if (!url) continue;
    if (start > last) parts.push(text.slice(last, start));
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    parts.push(
      <a
        key={`${start}-${url}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-primary underline underline-offset-2 hover:text-primary/80"
      >
        {url}
      </a>,
    );
    if (rest) parts.push(rest);
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Multi-line user text: line breaks kept and links clickable. Descriptions were
 * rendered as one run-on paragraph with dead URLs (FD-043).
 */
export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  return <p className={cn("whitespace-pre-wrap break-words", className)}>{linkify(text)}</p>;
}
