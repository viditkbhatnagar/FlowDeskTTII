import { toast } from "sonner";
import { linkHostname, safeHref } from "@/lib/links";
import { fileUrl, formatBytes, type StoredFile } from "@/lib/task-api";

/**
 * Open a web link in a new tab with rel="noopener noreferrer", through a real
 * anchor so it opens as a tab (not a popup window) and the destination gets
 * neither window.opener nor a referrer. Returns false, and opens nothing, for
 * anything safeHref refuses (javascript:, data:, spaces, other schemes).
 */
export function openLink(url: string): boolean {
  const href = safeHref(url);
  if (!href) return false;
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  // Attached for the click: some browsers ignore clicks on detached anchors.
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}

/**
 * Open a file or a link in a new tab, or download a file. A link has nothing
 * to download, so `download` opens it as well.
 */
export async function openStoredFile(file: StoredFile, download = false): Promise<void> {
  if (file.kind === "link") {
    if (!openLink(file.url)) toast.error(`${file.name} could not be opened.`);
    return;
  }
  // The tab is opened before the await: one opened after it counts as a popup
  // and is blocked, which is why Preview appeared to do nothing (FD-060).
  const tab = download ? null : window.open("", "_blank");
  const url = await fileUrl(file, download);
  if (!url) {
    tab?.close();
    toast.error(`${file.name} could not be opened.`);
    return;
  }
  if (download) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.rel = "noopener";
    anchor.click();
    return;
  }
  if (tab) {
    tab.opener = null;
    tab.location.href = url;
  } else {
    window.open(url, "_blank", "noopener");
  }
}

/** The line under a name: "1.2 MB" for a file, the hostname for a link. */
export function storedFileDetail(file: StoredFile): string {
  return file.kind === "link" ? linkHostname(file.url) || "Link" : formatBytes(file.size);
}

/** "PDF", "XLSX"… from the file name, or "Link" — for a type column or filter. */
export function storedFileType(file: StoredFile): string {
  if (file.kind === "link") return "Link";
  return /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toUpperCase() ?? "File";
}
