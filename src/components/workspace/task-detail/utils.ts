import { useCallback, useEffect, useRef, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";

/** "3 minutes ago", from a real timestamp. The old modal made these up (FD-005). */
export function timeAgo(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : formatDistanceToNow(date, { addSuffix: true });
}

/** Full date and time, for the tooltip on a relative time. */
export function fullTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : format(date, "MMM d, yyyy 'at' h:mm a");
}

/** Formats an ISO date, or returns the fallback when it is missing or unparseable. */
export function formatDate(iso: string | undefined, pattern: string, fallback = "—"): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? fallback : format(date, pattern);
}

export type ResourceStatus = "loading" | "ready" | "error";

/**
 * Loads one list for the open task (comments, files, activity) and reloads it
 * whenever `key` changes. The loaders return null on failure, which becomes an
 * explicit error state instead of an empty list that looks like "nothing here".
 */
export function useTaskResource<T>(load: () => Promise<T | null>, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<ResourceStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let active = true;
    // Keep what is already shown while a refresh runs; only a first load shows a spinner.
    setStatus((current) => (current === "ready" ? current : "loading"));
    loadRef
      .current()
      .catch((error: unknown) => {
        console.error("[flowdesk] task detail load failed", error);
        return null;
      })
      .then((result) => {
        if (!active) return;
        if (result === null) {
          setStatus((current) => (current === "ready" ? current : "error"));
          return;
        }
        setData(result);
        setStatus("ready");
      });
    return () => {
      active = false;
    };
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const update = useCallback((change: (current: T) => T) => {
    setData((current) => (current === null ? current : change(current)));
  }, []);

  return { data, status, reload, update };
}
