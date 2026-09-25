import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Settings, Sparkles, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  mainItems,
  settingsItems,
  type WorkspaceNavId,
} from "@/routes/_authenticated/-workspace-nav";

export function Sidebar({
  active,
  onNavigate,
  open,
  collapsed,
  onToggleCollapse,
  showSettings = false,
}: {
  active: WorkspaceNavId;
  /** Called after a nav link is followed, e.g. to close the mobile drawer. */
  onNavigate?: () => void;
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
            <Sparkles className="h-4 w-4" aria-hidden="true" />
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
            type="button"
            onClick={onToggleCollapse}
            className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {collapsed && onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="absolute right-[-10px] top-[18px] z-50 flex h-5 w-5 items-center justify-center rounded-full border border-sidebar-border bg-card text-muted-foreground shadow-sm hover:text-foreground transition"
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </button>
      )}

      <nav aria-label="Workspace" className={cn("py-4 space-y-0.5", collapsed ? "px-2" : "px-3")}>
        {!collapsed && (
          <div className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Workspace
          </div>
        )}
        {mainItems.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <Link
              key={item.id}
              to={item.to}
              activeOptions={{ exact: true, includeSearch: false }}
              onClick={onNavigate}
              className={cn(
                "group relative flex items-center rounded-lg transition-all",
                collapsed ? "justify-center w-full px-2 py-2.5" : "w-full justify-between gap-3 px-3 py-2",
                isActive
                  ? "bg-primary/10 text-sidebar-accent-foreground font-medium shadow-sm ring-1 ring-primary/10"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
              // Collapsed, the item is an icon alone; the label is its accessible name (FD-054).
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
            >
              <span className={cn("flex items-center", collapsed ? "justify-center" : "gap-3")}>
                <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} aria-hidden="true" />
                {!collapsed && <span className="text-sm">{item.label}</span>}
              </span>
            </Link>
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
            type="button"
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
            aria-label="Settings"
            title="Settings"
          >
            <Settings className={cn("h-4 w-4 shrink-0", activeSettings && "text-primary")} aria-hidden="true" />
            {activeSettings && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" aria-hidden="true" />}
          </button>
        ) : (
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              aria-controls="sidebar-settings-items"
              className={cn(
                "w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-all",
                activeSettings
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              <span className="flex items-center gap-3">
                <Settings className={cn("h-4 w-4 shrink-0", activeSettings && "text-primary")} aria-hidden="true" />
                <span className="text-sm">Settings</span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                  settingsOpen && "rotate-180"
                )}
              />
            </button>

            {settingsOpen && (
              <div id="sidebar-settings-items" className="ml-2 space-y-0.5 border-l border-sidebar-border pl-2">
                {settingsItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = active === item.id;
                  return (
                    <Link
                      key={item.id}
                      to={item.to}
                      activeOptions={{ exact: true, includeSearch: false }}
                      onClick={onNavigate}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-lg px-3 py-2 transition-all",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} aria-hidden="true" />
                      <span className="text-sm">{item.label}</span>
                    </Link>
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
