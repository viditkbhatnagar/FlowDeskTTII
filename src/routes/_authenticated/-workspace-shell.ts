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
  // Always return the key: the router lays this over the raw query string, so a key left
  // out would keep its unvalidated value (?filter=1 arrives as the number 1).
  return { filter: filter || undefined };
}

/** Each page names the browser tab; it used to say "Flowdesk" everywhere (FD-038). */
export function pageHead(id: WorkspaceNavId) {
  const label = workspaceNavItems.find((item) => item.id === id)?.label ?? "Workspace";
  return { meta: [{ title: `${label} — Flowdesk` }] };
}

const passedGuards = new Set<string>();

/**
 * Runs a layout's access check on the way in, and skips it while moving between pages under
 * that layout (cause "stay"). router-core also reports "stay" on the first load after SSR
 * hydration, because the dehydrated match counts as the previous one, so a check is skipped
 * only once it has passed in this browser for this key.
 */
export async function checkOnEntry(
  key: string,
  cause: string,
  check: () => Promise<void>,
): Promise<void> {
  if (cause === "stay" && passedGuards.has(key)) return;
  await check();
  passedGuards.add(key);
}

/**
 * Whether the signed-in person can use the workspace, and if not, why:
 * "deactivated" (an admin switched their account off) or "no-organization"
 * (no active membership anywhere). Deactivate also switches off every
 * membership, so the account's own status is checked first to tell the two
 * apart. Row-level security lets a person read their own profile and
 * memberships whatever their status.
 *
 * Throws when the lookup itself fails: that is not a verdict, and the error
 * page offers Try again.
 */
export type AccountAccess = "ok" | "deactivated" | "no-organization";

export async function loadAccountAccess(userId: string): Promise<AccountAccess> {
  const [profile, memberships] = await Promise.all([
    supabase.from("profiles").select("status").eq("user_id", userId).maybeSingle(),
    supabase
      .from("organization_memberships")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "active"),
  ]);
  if (profile.error) throw new Error(`Could not load your account: ${profile.error.message}`);
  if (memberships.error) {
    throw new Error(`Could not load your organizations: ${memberships.error.message}`);
  }
  if (profile.data?.status === "inactive") return "deactivated";
  if (!memberships.count) return "no-organization";
  return "ok";
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
