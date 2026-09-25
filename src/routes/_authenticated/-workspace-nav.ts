// The workspace pages and their URLs, shared by the sidebar, the header title and
// each page's tab title. The leading "-" keeps the router generator from treating
// this file as a route.
import {
  Building2,
  CheckSquare,
  FolderKanban,
  LayoutDashboard,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";

/**
 * Every workspace page and its own URL. The workspace used to keep the current page
 * in React state, so the address bar always said "/", a reload went back to the
 * Dashboard, Back/Forward did nothing and /projects was a 404 (FD-038).
 */
export const mainItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, to: "/" },
  // No hardcoded badge: the previous literal `badge: 6` never matched anything real.
  { id: "my-tasks", label: "My Tasks", icon: CheckSquare, to: "/my-tasks" },
  { id: "team", label: "Team Tasks", icon: Users, to: "/team" },
  { id: "projects", label: "Projects", icon: FolderKanban, to: "/projects" },
] as const;

export const settingsItems = [
  {
    id: "settings-organizations",
    label: "Organizations",
    icon: Building2,
    to: "/settings/organizations",
  },
  { id: "settings-users", label: "Users", icon: Users, to: "/settings/users" },
  {
    id: "settings-structure",
    label: "Teams & Departments",
    icon: Network,
    to: "/settings/structure",
  },
  { id: "settings-roles", label: "Roles & Permissions", icon: ShieldCheck, to: "/settings/roles" },
  {
    id: "settings-tasks",
    label: "Task & Project Settings",
    icon: SlidersHorizontal,
    to: "/settings/tasks",
  },
] as const;

export type WorkspaceNavItem = (typeof mainItems)[number] | (typeof settingsItems)[number];
export type WorkspaceNavId = WorkspaceNavItem["id"];

export const workspaceNavItems: readonly WorkspaceNavItem[] = [...mainItems, ...settingsItems];

/** The page a pathname belongs to; unknown paths fall back to the Dashboard. */
export function navItemForPath(pathname: string): WorkspaceNavItem {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return workspaceNavItems.find((item) => item.to === path) ?? mainItems[0];
}
