import { useState, useEffect } from "react";
import {
  LayoutDashboard, CheckSquare, Users, FolderKanban,
  Settings, Sparkles, ChevronLeft, ChevronRight,
  ChevronDown, Building2, Network, ShieldCheck, SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

const mainItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "my-tasks", label: "My Tasks", icon: CheckSquare, badge: 6 },
  { id: "team", label: "Team Tasks", icon: Users },
  { id: "projects", label: "Projects", icon: FolderKanban },
];

const settingsItems = [
  { id: "settings-organizations", label: "Organizations", icon: Building2 },
  { id: "settings-users", label: "Users", icon: Users },
  { id: "settings-structure", label: "Teams & Departments", icon: Network },
  { id: "settings-roles", label: "Roles & Permissions", icon: ShieldCheck },
  { id: "settings-tasks", label: "Task & Project Settings", icon: SlidersHorizontal },
];

export function Sidebar({
  active,
  onChange,
  open,
  collapsed,
  onToggleCollapse,
  showSettings = false,
}: {
  active: string;
  onChange: (id: string) => void;
  open: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  showSettings?: boolean;
}) {
  const activeSettings = active.startsWith("settings-");
  const [settingsOpen, setSettingsOpen] = useState(activeSettings);

  useEffect(() => {
    if (activeSettings) setSettingsOpen(true);
  }, [activeSettings]);

  return (
    <aside
      className={cn(
        "glass-surface fixed inset-y-0 left-0 z-40 border-r border-sidebar-border bg-sidebar/90 transition-all duration-300 lg:translate-x-0 lg:static lg:z-0",
        collapsed ? "w-16" : "w-64",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className={cn(
        "flex h-16 items-center border-b border-sidebar-border",
        collapsed ? "justify-center px-2" : "justify-between px-5 gap-2"
      )}>
        <div className={cn("flex items-center", collapsed ? "justify-center" : "gap-2")}>
          <div className="brand-mark flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div>
              <div className="text-sm font-semibold text-sidebar-foreground">Flowdesk</div>
              <div className="text-[11px] text-muted-foreground -mt-0.5">Operations Suite</div>
            </div>
          )}
        </div>

        {!collapsed && onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {collapsed && onToggleCollapse && (
        <button
          onClick={onToggleCollapse}
          className="absolute right-[-10px] top-[18px] z-50 flex h-5 w-5 items-center justify-center rounded-full border border-sidebar-border bg-card text-muted-foreground shadow-sm hover:text-foreground transition"
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      )}

      <nav className={cn("py-4 space-y-0.5", collapsed ? "px-2" : "px-3")}>
        {!collapsed && (
          <div className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Workspace
          </div>
        )}
        {mainItems.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={cn(
                "group relative flex items-center rounded-lg transition-all",
                collapsed ? "justify-center w-full px-2 py-2.5" : "w-full justify-between gap-3 px-3 py-2",
                isActive
                  ? "bg-primary/10 text-sidebar-accent-foreground font-medium shadow-sm ring-1 ring-primary/10"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
              title={collapsed ? item.label : undefined}
            >
              <span className={cn("flex items-center", collapsed ? "justify-center" : "gap-3")}>
                <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} />
                {!collapsed && <span className="text-sm">{item.label}</span>}
              </span>
              {!collapsed && item.badge && (
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {item.badge}
                </span>
              )}
              {collapsed && item.badge && (
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
              )}
            </button>
          );
        })}

        {/* Settings group */}
        {showSettings && !collapsed && (
          <div className="px-2 pb-2 pt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Settings
          </div>
        )}

        {showSettings && (collapsed ? (
          <button
            onClick={() => {
              onToggleCollapse?.();
              setSettingsOpen(true);
            }}
            className={cn(
              "group relative flex items-center justify-center w-full rounded-lg px-2 py-2.5 transition-all",
              activeSettings
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            )}
            title="Settings"
          >
            <Settings className={cn("h-4 w-4 shrink-0", activeSettings && "text-primary")} />
            {activeSettings && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />}
          </button>
        ) : (
          <div className="space-y-0.5">
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className={cn(
                "w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-all",
                activeSettings
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              <span className="flex items-center gap-3">
                <Settings className={cn("h-4 w-4 shrink-0", activeSettings && "text-primary")} />
                <span className="text-sm">Settings</span>
              </span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                  settingsOpen && "rotate-180"
                )}
              />
            </button>

            {settingsOpen && (
              <div className="ml-2 space-y-0.5 border-l border-sidebar-border pl-2">
                {settingsItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = active === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onChange(item.id)}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-lg px-3 py-2 transition-all",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} />
                      <span className="text-sm">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}
