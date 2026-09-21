import { AlertTriangle, Loader2 } from "lucide-react";
import type { WorkspaceStatus } from "@/lib/workspace-data";

/**
 * Loading / error state for the task views.
 *
 * The task provider used to seed itself with sample tasks, so a slow or failed query
 * was indistinguishable from real work. It now starts empty and reports its status,
 * and this renders the two states that are not "here are your tasks".
 *
 * Returns null once the data is ready, or while tasks are already on screen — a
 * background refetch must not blank out a working board.
 */
export function WorkspaceState({ status, hasTasks }: { status: WorkspaceStatus; hasTasks: boolean }) {
  if (status === "ready" || hasTasks) return null;

  if (status === "loading") {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card/60 py-16 text-center"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Loading your tasks…</p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 py-16 text-center"
      role="alert"
    >
      <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-foreground">We couldn&rsquo;t load your tasks.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Check your connection and refresh the page. Nothing has been lost.
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        Retry
      </button>
    </div>
  );
}
