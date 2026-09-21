import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Sidebar } from "@/components/workspace/Sidebar";
import { Header } from "@/components/workspace/Header";
import { NewTaskDialog } from "@/components/workspace/NewTaskDialog";
import { DashboardPage } from "@/components/workspace/DashboardPage";
import { MyTasksPage } from "@/components/workspace/MyTasksPage";
import { TeamTasksPage } from "@/components/workspace/TeamTasksPage";
import { ProjectsPage } from "@/components/workspace/ProjectsPage";
import { WorkspaceProvider } from "@/lib/workspace-data";
import { OrganizationsProvider, useOrganizations } from "@/lib/organizations-data";
import { OrganizationsPage } from "@/components/workspace/OrganizationsPage";
import { UsersPage } from "@/components/workspace/UsersPage";
import { StructurePage } from "@/components/workspace/StructurePage";
import { RolesPage } from "@/components/workspace/RolesPage";
import { TaskProjectSettingsPage } from "@/components/workspace/TaskProjectSettingsPage";
import { TaskSettingsProvider } from "@/lib/task-settings-data";
import { supabase } from "@/integrations/supabase/client";
import { redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/")({
  beforeLoad: async () => {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) throw redirect({ to: "/auth" });
    const { count } = await supabase
      .from("organization_memberships")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authData.user.id)
      .eq("status", "active");
    if (!count) throw redirect({ to: "/no-organization" });
  },
  head: () => ({
    meta: [
      { title: "Flowdesk — Task Management for Operations Teams" },
      {
        name: "description",
        content:
          "A clean, minimal task management workspace with Kanban, list, and calendar views, projects, and team productivity.",
      },
      { property: "og:title", content: "Flowdesk — Task Management for Operations Teams" },
      {
        property: "og:description",
        content:
          "A clean, minimal task management workspace with Kanban, list, and calendar views, projects, and team productivity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Workspace,
});

function Workspace() {
  const [nav, setNav] = useState("dashboard");
  const [taskFilter, setTaskFilter] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  return (
    <OrganizationsProvider>
    <TaskSettingsProvider>
    <WorkspaceProvider>
      <WorkspaceShell
        nav={nav}
        setNav={setNav}
        taskFilter={taskFilter}
        setTaskFilter={setTaskFilter}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        newTaskOpen={newTaskOpen}
        setNewTaskOpen={setNewTaskOpen}
      />
    </WorkspaceProvider>
    </TaskSettingsProvider>
    </OrganizationsProvider>
  );
}

function WorkspaceShell({ nav, setNav, taskFilter, setTaskFilter, sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed, newTaskOpen, setNewTaskOpen }: {
  nav: string;
  setNav: (value: string) => void;
  taskFilter?: string;
  setTaskFilter: (value?: string) => void;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  newTaskOpen: boolean;
  setNewTaskOpen: (value: boolean) => void;
}) {
  const { canManageUsers } = useOrganizations();

  return (
      <div className="workspace-canvas min-h-screen flex bg-background text-foreground">
        <Sidebar
          active={nav}
          onChange={(id) => {
            setNav(id);
             setTaskFilter(undefined);
            setSidebarOpen(false);
          }}
          open={sidebarOpen}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          showSettings={canManageUsers}
        />

        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-foreground/20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <Header
            title={
              nav === "my-tasks"
                ? "My Tasks"
                : nav === "team"
                  ? "Team Tasks"
                : nav === "projects"
                    ? "Projects"
                    : nav === "settings-organizations"
                      ? "Organizations"
                      : nav === "settings-users"
                        ? "Users"
                        : nav === "settings-structure"
                          ? "Teams & Departments"
                          : nav === "settings-roles"
                            ? "Roles & Permissions"
                            : nav === "settings-tasks"
                              ? "Task & Project Settings"
                              : "Dashboard"
            }
            showOrgSwitcher={nav === "my-tasks" || nav === "team" || nav === "projects"}
            onNavigate={(destination) => { setNav(destination); setTaskFilter(undefined); }}
            onNewTask={() => setNewTaskOpen(true)}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
          />

          <main className="flex-1 px-4 md:px-6 py-6 space-y-6 max-w-[1600px] w-full mx-auto">
            {nav === "my-tasks" ? (
              <MyTasksPage onNewTask={() => setNewTaskOpen(true)} dashboardFilter={taskFilter} />
            ) : nav === "team" ? (
              <TeamTasksPage onNewTask={() => setNewTaskOpen(true)} dashboardFilter={taskFilter} />
            ) : nav === "projects" ? (
              <ProjectsPage onNewTask={() => setNewTaskOpen(true)} dashboardFilter={taskFilter} />
            ) : nav === "settings-organizations" ? (
              <OrganizationsPage />
            ) : nav === "settings-users" ? (
              <UsersPage />
            ) : nav === "settings-structure" ? (
              <StructurePage />
            ) : nav === "settings-roles" ? (
              <RolesPage />
            ) : nav === "settings-tasks" ? (
              <TaskProjectSettingsPage />
            ) : (
              <DashboardPage
                onNavigate={(destination, filter) => {
                  setNav(destination);
                  setTaskFilter(filter);
                }}
              />
            )}
          </main>
        </div>

        <NewTaskDialog open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
      </div>
  );
}
