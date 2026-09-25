export type RenderedEmail = { subject: string; html: string };

/** assetBaseUrl is the public origin that serves /brand/*, e.g. "https://flowdesk.upcarrera.com". */
export type RenderContext = { assetBaseUrl: string };

export const EMAIL_HEADER_IMAGE_PATH = "/brand/flowdesk-email-header.png";

const LINK_PROTOCOLS = ["http:", "https:"] as const;
// file: only so local previews can load the logo; it is never user-controlled.
const ASSET_PROTOCOLS = ["http:", "https:", "file:"] as const;

export const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function allowedUrl(value: string, protocols: readonly string[]): string | null {
  const trimmed = value.trim();
  try {
    return protocols.includes(new URL(trimmed).protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

/** Escaped href: http(s) URLs only, anything else becomes "#". */
export const safeHref = (value: string) => escapeHtml(allowedUrl(value, LINK_PROTOCOLS) ?? "#");

export function headerImageSrc(ctx: RenderContext): string {
  const base = ctx.assetBaseUrl.trim().replace(/\/+$/, "");
  return escapeHtml(allowedUrl(`${base}${EMAIL_HEADER_IMAGE_PATH}`, ASSET_PROTOCOLS) ?? "");
}

/** Subjects are plain text for the mail header: no markup escaping, no line breaks. */
export const plainSubject = (value: string) => value.replace(/\s+/g, " ").trim();

const CARD_STYLE =
  "width:600px;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 10px 30px rgba(16,27,54,.08);";

const BASE_MOBILE_CSS = `.email-shell { width: 100% !important; }
      .email-pad { padding-left: 24px !important; padding-right: 24px !important; }`;

export const BUTTON_MOBILE_CSS =
  ".button { display: block !important; text-align: center !important; }";

export const SUMMARY_MOBILE_CSS =
  ".summary-cell { display: block !important; width: 100% !important; box-sizing: border-box !important; }";

/**
 * Mobile rules for a label/value details panel: rows stack, values left-align, and each
 * stacked cell keeps its padding inside the panel. The label rule evens out the gap for the
 * last (or only) row, which otherwise keeps 18px below it.
 */
export const detailsMobileCss = (className: string) =>
  [
    `.${className} td { display: block !important; width: 100% !important; box-sizing: border-box !important; }`,
    `.${className} .label { padding-bottom: 9px !important; }`,
    `.${className} .value { padding-top: 4px !important; text-align: left !important; }`,
  ].join("\n      ");

type EmailDocument = {
  /** Plain text; also the subject line. */
  title: string;
  /** Plain text shown as the inbox preview line. */
  preheader: string;
  /** Extra rules inside the max-width:620px media query. */
  mobileCss: string[];
  /** Trusted HTML for the body cell; every dynamic value must already be escaped. */
  content: string;
};

function headerRow(ctx: RenderContext) {
  return `<tr>
            <td class="email-pad" style="background:#081a3a;padding:28px 44px;">
              <img src="${headerImageSrc(ctx)}" width="180" height="60" alt="Flowdesk Operations Suite" style="display:block;width:180px;max-width:100%;height:auto;border:0;">
            </td>
          </tr>`;
}

const FOOTER_ROW = `<tr>
            <td class="email-pad" style="border-top:1px solid #e5eaf1;padding:22px 44px;background:#fbfcfe;">
              <p style="margin:0;font-size:14px;font-weight:700;line-height:20px;color:#101b36;">Flowdesk</p>
              <p style="margin:2px 0 0;font-size:10px;line-height:16px;letter-spacing:2px;text-transform:uppercase;color:#7b8498;">Operations Suite</p>
            </td>
          </tr>`;

export function renderEmailDocument(doc: EmailDocument, ctx: RenderContext): RenderedEmail {
  const subject = plainSubject(doc.title);
  const mobileCss = [BASE_MOBILE_CSS, ...doc.mobileCss].join("\n      ");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(subject)}</title>
  <style>
    @media only screen and (max-width: 620px) {
      ${mobileCss}
    }
  </style>
</head>
<body style="margin:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#101b36;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(plainSubject(doc.preheader))}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef2f7;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" class="email-shell" width="600" cellspacing="0" cellpadding="0" border="0" style="${CARD_STYLE}">
          ${headerRow(ctx)}
          <tr>
            <td class="email-pad" style="padding:44px 44px 40px;word-break:break-word;overflow-wrap:anywhere;">
              ${doc.content}
            </td>
          </tr>
          ${FOOTER_ROW}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return { subject, html };
}

export const greeting = (firstName: string) =>
  `<p style="margin:0 0 18px;font-size:17px;line-height:27px;color:#101b36;">Hi ${escapeHtml(firstName)},</p>`;

export const primaryButton = (href: string, label: string, padding = "24px 0 0") =>
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr><td style="padding:${padding};">
                  <a class="button" href="${safeHref(href)}" style="display:inline-block;background:#1468ff;border-radius:5px;color:#ffffff;font-size:15px;font-weight:700;line-height:20px;padding:14px 24px;text-decoration:none;">${escapeHtml(label)}</a>
                </td></tr>
              </table>`;

type DetailRow = { label: string; value: string; valueColor?: string };

const DETAIL_PADDING = {
  first: "18px 20px 9px",
  middle: "9px 20px",
  last: "9px 20px 18px",
  only: "18px 20px",
};

function detailPadding(index: number, count: number) {
  if (count === 1) return DETAIL_PADDING.only;
  if (index === 0) return DETAIL_PADDING.first;
  return index === count - 1 ? DETAIL_PADDING.last : DETAIL_PADDING.middle;
}

/** The grey label/value panel every transactional email uses. Values are escaped here. */
export function detailsTable(className: string, rows: DetailRow[]) {
  const body = rows
    .map((row, index) => {
      const padding = detailPadding(index, rows.length);
      return `<tr>
                  <td class="label" style="padding:${padding};font-size:13px;line-height:20px;color:#68738a;">${escapeHtml(row.label)}</td>
                  <td class="value" style="padding:${padding};font-size:14px;line-height:20px;font-weight:700;text-align:right;color:${row.valueColor ?? "#101b36"};">${escapeHtml(row.value)}</td>
                </tr>`;
    })
    .join("\n                ");
  return `<table role="presentation" class="${className}" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;border:1px solid #dce4ef;border-radius:6px;">
                ${body}
              </table>`;
}

/** Optional detail row: Naji omits the Project row when there is no project. */
export const optionalRow = (label: string, value: string): DetailRow[] =>
  value.trim() ? [{ label, value }] : [];

export type StatCell = { count: string; label: string; background: string; color: string };

export const stat = (
  count: string,
  label: string,
  background: string,
  color: string,
): StatCell => ({
  count,
  label,
  background,
  color,
});

/** Coloured count tiles; `width` is the per-cell percentage ("25%" or "33.33%"). */
export function statRows(rows: StatCell[][], width: string, cellPadding: string) {
  const cells = (row: StatCell[]) =>
    row
      .map(
        (cell) =>
          `<td class="summary-cell" width="${width}" style="padding:${cellPadding};background:${cell.background};text-align:center;"><strong style="display:block;font-size:20px;color:${cell.color};">${escapeHtml(cell.count)}</strong><span style="font-size:11px;color:#68738a;">${escapeHtml(cell.label)}</span></td>`,
      )
      .join("");
  const trs = rows.map((row) => `<tr>${cells(row)}</tr>`).join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;">${trs}</table>`;
}

export const bodyText = (html: string, margin = "0 0 28px") =>
  `<p style="margin:${margin};font-size:15px;line-height:25px;color:#4d5870;">${html}</p>`;

export const noteText = (html: string, margin = "0") =>
  `<p style="margin:${margin};font-size:13px;line-height:21px;color:#68738a;">${html}</p>`;

export const periodLabel = (dateRange: string) =>
  `<p style="margin:0 0 22px;font-size:12px;font-weight:700;line-height:18px;color:#68738a;">Reporting period: ${escapeHtml(dateRange)}</p>`;

/** Grouped list sections (digests and summaries) show at most this many rows per group. */
export const SECTION_VISIBLE_LIMIT = 5;

export const sectionHeading = (label: string) =>
  `<p style="margin:0 0 5px;font-size:12px;font-weight:700;line-height:18px;text-transform:uppercase;color:#68738a;">${escapeHtml(label)}</p>`;

export function viewAllRow(label: string, total: number, url: string | undefined) {
  if (total <= SECTION_VISIBLE_LIMIT || !url) return "";
  return `<tr><td style="padding:10px 0 2px;"><a href="${safeHref(url)}" style="font-size:12px;font-weight:700;color:#1468ff;text-decoration:none;">View all ${escapeHtml(label.toLowerCase())}</a></td></tr>`;
}

export const taskLink = (url: string, title: string) =>
  `<a href="${safeHref(url)}" style="font-size:14px;font-weight:700;line-height:21px;color:#1468ff;text-decoration:none;">${escapeHtml(title)}</a>`;

type OrgCard = { name: string; summary?: string; groupsHtml: string };

/** One organization's grey card wrapping its grouped sections. */
export function organizationCard(card: OrgCard) {
  const summary =
    card.summary === undefined
      ? ""
      : `<tr><td style="padding:4px 20px 0;font-size:12px;line-height:18px;color:#68738a;">${escapeHtml(card.summary)}</td></tr>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;background:#f4f7fb;border:1px solid #dce4ef;border-radius:6px;">
      <tr><td style="padding:18px 20px 0;font-size:16px;font-weight:700;line-height:22px;color:#101b36;">${escapeHtml(card.name)}</td></tr>${summary}
      <tr><td style="padding:0 20px 18px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${card.groupsHtml}</table></td></tr>
    </table>`;
}

export const groupBlock = (label: string, rowsHtml: string) =>
  `<tr><td style="padding:18px 0 0;">
        ${sectionHeading(label)}
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${rowsHtml}</table>
      </td></tr>`;

export type ListTask = { title: string; url: string; projectName?: string; dateLabel: string };
export type ListGroup<Label extends string> = {
  label: Label;
  tasks: ListTask[];
  viewAllUrl?: string;
};
export type ListOrganization<Label extends string> = { name: string; groups: ListGroup<Label>[] };

function listTaskRow(task: ListTask) {
  const project = task.projectName
    ? `<span style="color:#7b8498;"> · ${escapeHtml(task.projectName)}</span>`
    : "";
  return `<tr><td style="padding:8px 0;border-bottom:1px solid #e5eaf1;">
          ${taskLink(task.url, task.title)}
          <div style="margin-top:2px;font-size:12px;line-height:18px;color:#68738a;">${escapeHtml(task.dateLabel)}${project}</div>
        </td></tr>`;
}

/** Personal digest sections: one card per organization, empty groups skipped. */
export function buildTaskListSections<Label extends string>(
  organizations: ListOrganization<Label>[],
) {
  return organizations
    .map((organization) => {
      const groupsHtml = organization.groups
        .filter((group) => group.tasks.length > 0)
        .map((group) => {
          const rows = group.tasks.slice(0, SECTION_VISIBLE_LIMIT).map(listTaskRow).join("");
          return groupBlock(
            group.label,
            rows + viewAllRow(group.label, group.tasks.length, group.viewAllUrl),
          );
        })
        .join("");
      return organizationCard({ name: organization.name, groupsHtml });
    })
    .join("");
}
