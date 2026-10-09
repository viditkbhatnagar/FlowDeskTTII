import { Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { linkHostname, safeHref, type LinkInput } from "@/lib/links";
import { cn } from "@/lib/utils";

export interface PendingLinkListProps {
  links: LinkInput[];
  onRemove: (index: number) => void;
  className?: string;
}

/**
 * Links added in a form that are saved once the task or project exists: link
 * icon, name (opens the link in a new tab, to check it is the right one),
 * hostname and a remove button. Renders nothing when there are none.
 */
export function PendingLinkList({ links, onRemove, className }: PendingLinkListProps) {
  if (!links.length) return null;
  return (
    <ul aria-label="Links to add" className={cn("space-y-1.5", className)}>
      {links.map((link, index) => {
        const href = safeHref(link.url);
        return (
          <li
            key={link.url}
            className="flex items-center gap-3 rounded-md border border-border py-1 pl-3 pr-1 text-xs"
          >
            <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                title={href}
              >
                {link.name}
                <span className="sr-only"> (link, opens in a new tab)</span>
              </a>
            ) : (
              <span className="min-w-0 flex-1 truncate">{link.name}</span>
            )}
            <span className="max-w-[40%] shrink-0 truncate text-muted-foreground">
              {linkHostname(link.url)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label={`Remove ${link.name}`}
              onClick={() => onRemove(index)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
