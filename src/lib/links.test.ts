// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  LINK_RULES,
  defaultLinkName,
  linkHostname,
  normalizeLinkUrl,
  parseLinkInput,
  safeHref,
} from "./links";

const SHAREPOINT = "https://upcarrera.sharepoint.com/:w:/s/Admissions/EYk2x?e=AbC123&web=1";

describe("safeHref only lets plain web links through", () => {
  test("http and https links come back unchanged", () => {
    expect(safeHref(SHAREPOINT)).toBe(SHAREPOINT);
    expect(safeHref("http://intranet/handbook.pdf")).toBe("http://intranet/handbook.pdf");
    expect(safeHref("HTTPS://Example.com/a")).toBe("HTTPS://Example.com/a");
  });

  test("script and data links are refused", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JavaScript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHref("vbscript:msgbox(1)")).toBeNull();
  });

  test("other schemes and relative links are refused", () => {
    expect(safeHref("ftp://files.example.com/a")).toBeNull();
    expect(safeHref("mailto:hello@upcarrera.com")).toBeNull();
    expect(safeHref("file:///C:/secret.txt")).toBeNull();
    expect(safeHref("//example.com/a")).toBeNull();
    expect(safeHref("/projects")).toBeNull();
    expect(safeHref("example.com")).toBeNull();
  });

  test("spaces and control characters anywhere are refused", () => {
    expect(safeHref(" https://example.com")).toBeNull();
    expect(safeHref("https://example.com ")).toBeNull();
    expect(safeHref("https://example.com/a b")).toBeNull();
    expect(safeHref("https://example.com/\tx")).toBeNull();
    expect(safeHref("https://example.com/\nx")).toBeNull();
    expect(safeHref("java\tscript:alert(1)")).toBeNull();
    expect(safeHref("https://example.com/\u0000")).toBeNull();
    // Zero-width and right-to-left override characters disguise where a link goes.
    expect(safeHref("https://exa\u200bmple.com")).toBeNull();
    expect(safeHref("https://example.com/\u202Efdp.exe")).toBeNull();
  });

  test("empty, missing and hostless values are refused", () => {
    expect(safeHref("")).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref("https://")).toBeNull();
    expect(safeHref("http:///path")).toBeNull();
  });
});

describe("normalizeLinkUrl turns what was pasted into a link the database accepts", () => {
  test("a full link is kept as pasted, without surrounding spaces", () => {
    expect(normalizeLinkUrl(`  ${SHAREPOINT}\n`)).toEqual({ ok: true, url: SHAREPOINT });
  });

  test("a link without a scheme gets https://", () => {
    expect(normalizeLinkUrl("upcarrera.sharepoint.com/sites/Admissions")).toEqual({
      ok: true,
      url: "https://upcarrera.sharepoint.com/sites/Admissions",
    });
    expect(normalizeLinkUrl("www.example.com:8080/x")).toEqual({
      ok: true,
      url: "https://www.example.com:8080/x",
    });
    expect(normalizeLinkUrl("//example.com/a")).toEqual({ ok: true, url: "https://example.com/a" });
  });

  test("a typed scheme is taken at its word, even for a host without a dot", () => {
    expect(normalizeLinkUrl("http://intranet/handbook")).toEqual({
      ok: true,
      url: "http://intranet/handbook",
    });
  });

  test("an upper-case scheme is lowered, since the database check is case-sensitive", () => {
    expect(normalizeLinkUrl("HTTPS://Example.com/Path")).toEqual({
      ok: true,
      url: "https://Example.com/Path",
    });
  });

  test("an empty link asks for one", () => {
    const result = normalizeLinkUrl("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Paste or type a link.");
  });

  test("non-web schemes are refused with a sentence", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://example.com",
      "mailto:hello@upcarrera.com",
      "file:///C:/x",
    ]) {
      const result = normalizeLinkUrl(value);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toBe("Only web links (http:// or https://) can be added.");
    }
  });

  test("spaces inside the link are refused", () => {
    const result = normalizeLinkUrl("https://example.com/Shared Documents/a.docx");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cannot contain spaces");
  });

  test("something that is not a link is refused", () => {
    for (const value of [
      "https://",
      "http:/example.com",
      "https:///example.com",
      "https:\\\\example.com",
      "https://exa mple",
      // A name pasted into the link box.
      "Budget",
    ]) {
      expect(normalizeLinkUrl(value).ok).toBe(false);
    }
    const result = normalizeLinkUrl("https://");
    if (!result.ok)
      expect(result.error).toBe("This does not look like a web link. Check it and try again.");
  });

  test("a user name or password in the link is refused", () => {
    const result = normalizeLinkUrl("https://sharepoint.com@evil.example/login");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("user name or password");
  });

  test("links longer than the limit are refused; the limit itself is fine", () => {
    const prefix = "https://example.com/";
    const atLimit = prefix + "a".repeat(LINK_RULES.maxUrlLength - prefix.length);
    expect(atLimit.length).toBe(2048);
    expect(normalizeLinkUrl(atLimit)).toEqual({ ok: true, url: atLimit });
    const result = normalizeLinkUrl(`${atLimit}a`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Links can be at most 2048 characters.");
  });

  test("every accepted link is also a safe href", () => {
    for (const value of [SHAREPOINT, "example.com", "HTTP://a.b/c?d=e#f", "//x.org"]) {
      const result = normalizeLinkUrl(value);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(safeHref(result.url)).toBe(result.url);
        // The same pattern as the CHECK on task_attachments / project_documents.
        expect(/^https?:\/\/[^\s\p{Cc}]+$/u.test(result.url)).toBe(true);
      }
    }
  });
});

describe("hostname and default name", () => {
  test("the hostname is shown for a link", () => {
    expect(linkHostname(SHAREPOINT)).toBe("upcarrera.sharepoint.com");
    expect(linkHostname("https://WWW.Example.com:8443/a")).toBe("www.example.com");
  });

  test("an unreadable link has no hostname", () => {
    expect(linkHostname("not a link")).toBe("");
    expect(linkHostname("")).toBe("");
  });

  test("the default name is the hostname, or 'Link' when there is none", () => {
    expect(defaultLinkName(SHAREPOINT)).toBe("upcarrera.sharepoint.com");
    expect(defaultLinkName("nonsense")).toBe("Link");
  });
});

describe("parseLinkInput checks both fields of the Add link form", () => {
  test("a link with a name keeps the name, trimmed", () => {
    expect(parseLinkInput({ url: SHAREPOINT, name: "  Admissions handbook  " })).toEqual({
      ok: true,
      link: { url: SHAREPOINT, name: "Admissions handbook" },
    });
  });

  test("no name falls back to the hostname", () => {
    expect(parseLinkInput({ url: SHAREPOINT, name: "   " })).toEqual({
      ok: true,
      link: { url: SHAREPOINT, name: "upcarrera.sharepoint.com" },
    });
    expect(parseLinkInput({ url: "docs.google.com/d/1" })).toEqual({
      ok: true,
      link: { url: "https://docs.google.com/d/1", name: "docs.google.com" },
    });
  });

  test("line breaks and tabs in a name become single spaces", () => {
    const result = parseLinkInput({ url: SHAREPOINT, name: "Fee\n\tschedule" });
    expect(result).toEqual({ ok: true, link: { url: SHAREPOINT, name: "Fee schedule" } });
  });

  test("a name of 255 characters is fine; 256 is not", () => {
    const ok = parseLinkInput({ url: SHAREPOINT, name: "n".repeat(LINK_RULES.maxNameLength) });
    expect(ok.ok).toBe(true);
    const tooLong = parseLinkInput({ url: SHAREPOINT, name: "n".repeat(256) });
    expect(tooLong).toEqual({
      ok: false,
      errors: { name: "Names can be at most 255 characters." },
    });
  });

  test("the name length counts characters, as the database does, not UTF-16 units", () => {
    // 255 emoji are 510 UTF-16 units but 255 characters.
    const result = parseLinkInput({ url: SHAREPOINT, name: "📄".repeat(255) });
    expect(result.ok).toBe(true);
  });

  test("both fields report their own problem at once", () => {
    expect(parseLinkInput({ url: "javascript:alert(1)", name: "x".repeat(300) })).toEqual({
      ok: false,
      errors: {
        url: "Only web links (http:// or https://) can be added.",
        name: "Names can be at most 255 characters.",
      },
    });
  });
});
