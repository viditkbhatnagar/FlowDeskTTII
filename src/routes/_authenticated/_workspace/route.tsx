import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "@/components/workspace/Sidebar";
import { Header } from "@/components/workspace/Header";
import { NewTaskDialog } from "@/components/workspace/NewTaskDialog";
import { WorkspaceProvider } from "@/lib/workspace-data";
import { OrganizationsProvider, useOrganizations } from "@/lib/organizations-data";
import { TaskSettingsProvider } from "@/lib/task-settings-data";
import {
  checkOnEntry,
  DESTINATION_PATHS,
  loadAccountAccess,
  WorkspaceShellContext,
  type WorkspaceShell,
} from "@/routes/_authenticated/-workspace-shell";
import { navItemForPath } from "@/routes/_authenticated/-workspace-nav";

const DESCRIPTION =
  "A clean, minimal task management workspace with Kanban, list, and calendar views, projects, and team productivity.";

/** Pages that show work across organizations, and so offer the organization switcher. */
const ORG_SWITCHER_PAGES = new Set(["my-tasks", "team", "projects"]);

/**
 * The workspace frame (sidebar, header, New Task dialog and the data providers)
 * shared by every page. Each page is now its own child route with its own URL;
 * the frame used to hold the current page in React state, so the address bar
 * always read "/", reload went back to the Dashboard and /projects was a 404
 * (FD-038). As a layout it stays mounted between pages, so data is not reloaded.
 */
export const Route = createFileRoute("/_authenticated/_workspace")({
  // Checked on the way in, not on every move between workspace pages. A
  // deactivated account, or one in no organization, gets a page saying so
  // instead of an empty workspace. A failed lookup is neither: it throws, and
  // the error page offers Try again.
  beforeLoad: ({ context, cause }) =>
    checkOnEntry(`membership:${context.user.id}`, cause, async () => {
      const access = await loadAccountAccess(context.user.id);
      if (access !== "ok") throw redirect({ to: "/no-organization" });
    }),
  head: () => ({
    meta: [
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Flowdesk — Task Management for Operations Teams" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  return (
    <OrganizationsProvider>
      <TaskSettingsProvider>
        <WorkspaceProvider>
          <WorkspaceFrame />
        </WorkspaceProvider>
      </TaskSettingsProvider>
    </OrganizationsProvider>
  );
}

/**
 * Access can end while the workspace is open: an admin deactivates the person,
 * or removes their last organization. The entry check does not run again for
 * moves between pages, so this re-checks in the background after each move and
 * when the tab comes back into view, and shows the page that explains it.
 */
function useAccessWatch(userId: string, pathname: string) {
  const navigate = useNavigate();
  const check = useCallback(() => {
    void loadAccountAccess(userId)
      .then((access) => {
        if (access !== "ok") void navigate({ to: "/no-organization", replace: true });
      })
      // Not a verdict: the next move or focus checks again.
      .catch((error: unknown) => console.warn("[flowdesk] access check failed", error));
  }, [userId, navigate]);

  // The entry check has just run for the first page.
  const entered = useRef(false);
  useEffect(() => {
    if (!entered.current) {
      entered.current = true;
      return;
    }
    check();
  }, [pathname, check]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check]);
}

function WorkspaceFrame() {
  const { canManageUsers } = useOrganizations();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const userId = Route.useRouteContext({ select: (context) => context.user.id });
  useAccessWatch(userId, pathname);
  const current = navItemForPath(pathname);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const shell = useMemo<WorkspaceShell>(
    () => ({
      openNewTask: () => setNewTaskOpen(true),
      goTo: (destination, filter) => {
        void navigate({ to: DESTINATION_PATHS[destination], search: filter ? { filter } : {} });
      },
      goToUsers: () => {
        void navigate({ to: "/settings/users" });
      },
    }),
    [navigate],
  );

  return (
    <WorkspaceShellContext.Provider value={shell}>
      <div className="workspace-canvas min-h-screen flex bg-background text-foreground">
        <Sidebar
          active={current.id}
          onNavigate={() => setSidebarOpen(false)}
          open={sidebarOpen}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          showSettings={canManageUsers}
        />

        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-foreground/20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <Header
            title={current.label}
            showOrgSwitcher={ORG_SWITCHER_PAGES.has(current.id)}
            onNavigate={shell.goTo}
            onNewTask={shell.openNewTask}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
          />

          <main className="flex-1 px-4 md:px-6 py-6 space-y-6 max-w-[1600px] w-full mx-auto">
            <Outlet />
          </main>
        </div>

        <NewTaskDialog open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
      </div>
    </WorkspaceShellContext.Provider>
  );
}
