import { useState } from "react";
import { toast } from "sonner";
import type { LinkInput } from "@/lib/links";

export interface PendingLinks {
  links: LinkInput[];
  /** For AddLinkButton's onAdd: false (and a toast) when the link is already listed. */
  add: (link: LinkInput) => boolean;
  remove: (index: number) => void;
  clear: () => void;
}

/**
 * Links picked in a form before the task or project exists. Save them after it
 * is created with addTaskLinks / addProjectLinks, the way picked files are
 * uploaded after creation.
 */
export function usePendingLinks(): PendingLinks {
  const [links, setLinks] = useState<LinkInput[]>([]);
  return {
    links,
    add: (link) => {
      if (links.some((item) => item.url === link.url)) {
        toast.error("That link is already in the list.");
        return false;
      }
      setLinks([...links, link]);
      return true;
    },
    remove: (index) => setLinks((current) => current.filter((_, at) => at !== index)),
    clear: () => setLinks([]),
  };
}
