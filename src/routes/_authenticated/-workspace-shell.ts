// Shared by the workspace layout and its page routes. The leading "-" keeps the
// router generator from treating this file as a route.
import { createContext, useContext } from "react";
import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { SearchDestination } from "@/components/workspace/Header";
import { workspaceNavItems, type WorkspaceNavId } from "@/routes/_authenticated/-workspace-nav";

export type WorkspaceShell = {
  /** Opens the New Task dialog the layout owns. */
  openNewTask: () => void;
  /** Go to a task page, optionally with a dashboardFilter ("overdue", "task:<id>", ...). */
  goTo: (destination: SearchDestination, filter?: string) => void;
  goToUsers: () => void;
};

export const WorkspaceShellContext = createContext<WorkspaceShell | null>(null);

export function useWorkspaceShell(): WorkspaceShell {
  const shell = useContext(WorkspaceShellContext);
  if (!shell) throw new Error("useWorkspaceShell must be used inside the workspace layout");
  return shell;
}

/** Where each page a dashboard card or search result can open lives. */
export const DESTINATION_PATHS = {
  "my-tasks": "/my-tasks",
  team: "/team",
  projects: "/projects",
} as const satisfies Record<SearchDestination, string>;

/**
 * The dashboard's filter travels in the URL (?filter=overdue), so a filtered page
 * survives a reload and Back returns to it (FD-038, FD-030).
 */
export type FilterSearch = { filter?: string };

export function validateFilterSearch(search: Record<string, unknown>): FilterSearch {
  const filter = typeof search.filter === "string" ? search.filter.trim() : "";
  return filter ? { filter } : {};
}

/** Each page names the browser tab; it used to say "Flowdesk" everywhere (FD-038). */
export function pageHead(id: WorkspaceNavId) {
  const label = workspaceNavItems.find((item) => item.id === id)?.label ?? "Workspace";
  return { meta: [{ title: `${label} — Flowdesk` }] };
}

/**
 * Settings pages are listed only for admins. Now that each one has its own URL,
 * a deep link must not open them for everyone else either.
 */
export async function requireAdmin(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .limit(1);
  if (error) throw new Error(`Could not check your access: ${error.message}`);
  if (!data?.length) throw redirect({ to: "/", replace: true });
}
