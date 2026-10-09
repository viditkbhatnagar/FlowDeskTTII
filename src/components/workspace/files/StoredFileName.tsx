import { FileText, Link2 } from "lucide-react";
import { linkHostname, safeHref } from "@/lib/links";
import type { StoredFile } from "@/lib/task-api";
import { cn } from "@/lib/utils";

/**
 * Icon and name for a table cell. A file shows its name; a link shows a link
 * icon, its name as a link that opens in a new tab (rel="noopener noreferrer")
 * and its hostname underneath.
 */
export function StoredFileName({ file, className }: { file: StoredFile; className?: string }) {
  const href = file.kind === "link" ? safeHref(file.url) : null;
  const Icon = file.kind === "link" ? Link2 : FileText;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title={href}
          >
            {file.name}
            <span className="sr-only"> (link, opens in a new tab)</span>
          </a>
        ) : (
          <span className="break-all font-medium">{file.name}</span>
        )}
        {file.kind === "link" && (
          <div className="truncate text-[11px] text-muted-foreground">
            {linkHostname(file.url) || "Link cannot be opened"}
          </div>
        )}
      </div>
    </div>
  );
}
