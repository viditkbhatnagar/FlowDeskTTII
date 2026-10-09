import { ExternalLink, Link2, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeHref } from "@/lib/links";
import type { StoredFile, StoredUpload } from "@/lib/task-api";
import { cn } from "@/lib/utils";
import { fullTime, timeAgo } from "../task-detail/utils";
import { openStoredFile, storedFileDetail } from "./stored-file";

export interface FileOrLinkItemProps {
  file: StoredFile;
  /**
   * Opens an uploaded file; openStoredFile (a signed link in a new tab) by
   * default. A link is a real anchor and opens itself.
   */
  onOpen?: (file: StoredUpload) => void;
  /** Shows a remove button. Ask first: removing is for everyone. */
  onRemove?: (file: StoredFile) => void;
  className?: string;
}

/**
 * One attachment or document: a file (paperclip, size) or a link (link icon,
 * hostname, opens in a new tab with rel="noopener noreferrer").
 */
export function FileOrLinkItem({ file, onOpen, onRemove, className }: FileOrLinkItemProps) {
  const href = file.kind === "link" ? safeHref(file.url) : null;
  const Icon = file.kind === "link" ? Link2 : Paperclip;
  const iconButton = "h-7 w-7 shrink-0 text-muted-foreground";

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={`${file.name}\n${href}`}
          >
            {file.name}
            <span className="sr-only"> (link, opens in a new tab)</span>
          </a>
        ) : (
          <div className="truncate font-medium" title={file.name}>
            {file.name}
          </div>
        )}
        <div className="truncate text-[11px] text-muted-foreground">
          <span title={href ?? undefined}>
            {file.kind === "link" && !href ? "Link cannot be opened" : storedFileDetail(file)}
          </span>{" "}
          · {file.uploadedBy.name} ·{" "}
          <time dateTime={file.createdAt} title={fullTime(file.createdAt)}>
            {timeAgo(file.createdAt)}
          </time>
        </div>
      </div>
      {file.kind === "link" ? (
        href && (
          // The name above is the link for keyboards and screen readers; this
          // is the same link as a bigger target for the mouse.
          <Button asChild variant="ghost" size="icon" className={iconButton}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              tabIndex={-1}
              aria-hidden="true"
              title="Open in a new tab"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={iconButton}
          aria-label={`Open ${file.name}`}
          title="Open"
          onClick={() => (onOpen ? onOpen(file) : void openStoredFile(file))}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      )}
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(iconButton, "hover:text-destructive")}
          aria-label={`Remove ${file.name}`}
          title="Remove"
          onClick={() => onRemove(file)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
