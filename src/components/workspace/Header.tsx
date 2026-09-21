import { Search, Plus, Moon, Sun, Menu, ChevronDown, LogOut, User, Shield, CheckSquare, FolderKanban, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OrgSwitcher } from "@/components/workspace/OrgSwitcher";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-data";
import { useOrganizations } from "@/lib/organizations-data";
import { projects } from "@/lib/mock-data";

type SearchResult = {
  id: string;
  kind: "task" | "project" | "person";
  title: string;
  subtitle: string;
};

export function Header({
  onNewTask,
  onToggleSidebar,
  title,
  showOrgSwitcher = false,
  onNavigate,
}: {
  onNewTask: () => void;
  onToggleSidebar: () => void;
  title: string;
  showOrgSwitcher?: boolean;
  onNavigate?: (nav: string) => void;
}) {
  const [dark, setDark] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [name, setName] = useState("Account");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("Member");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { tasks } = useWorkspace();
  const { users } = useOrganizations();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const matches = (text: string | undefined) => text?.toLowerCase().includes(q);
    const taskResults: SearchResult[] = tasks
      .filter((t) => matches(t.title) || matches(t.project) || matches(t.assignee?.name) || t.tags?.some((tag) => matches(tag)))
      .slice(0, 5)
      .map((t) => ({ id: `task-${t.id}`, kind: "task", title: t.title, subtitle: t.project ? `Task · ${t.project}` : "Task" }));
    const projectResults: SearchResult[] = projects
      .filter((p) => matches(p.name))
      .slice(0, 4)
      .map((p) => ({ id: `project-${p.id}`, kind: "project", title: p.name, subtitle: "Project" }));
    const peopleResults: SearchResult[] = users
      .filter((u) => matches(u.name) || matches(u.email) || matches(u.designation))
      .slice(0, 4)
      .map((u) => ({ id: `person-${u.id}`, kind: "person", title: u.name, subtitle: u.designation ? `Person · ${u.designation}` : "Person" }));
    return [...taskResults, ...projectResults, ...peopleResults];
  }, [query, tasks, users]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => setHighlight(0), [results.length]);

  const openResult = (result: SearchResult) => {
    setSearchOpen(false);
    setQuery("");
    if (!onNavigate) return;
    if (result.kind === "task") onNavigate("my-tasks");
    else if (result.kind === "project") onNavigate("projects");
    else onNavigate("team");
  };

  const onSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      setSearchOpen(false);
      searchInputRef.current?.blur();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter" && results[highlight]) {
      event.preventDefault();
      openResult(results[highlight]);
    }
  };

  const kindIcon = (kind: SearchResult["kind"]) =>
    kind === "task" ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : kind === "project" ? <FolderKanban className="h-3.5 w-3.5 text-primary" /> : <Users className="h-3.5 w-3.5 text-primary" />;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setEmail(user.email ?? "");
      const fallbackName = (user.user_metadata?.full_name as string) || user.email?.split("@")[0] || "Account";
      setName(fallbackName);
      setUsername(user.email?.split("@")[0] ?? "user");

      const [{ data: profile }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("full_name, username, role, avatar_url").eq("user_id", user.id).single(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);

      if (profile) {
        setName(profile.full_name || fallbackName);
        setUsername(profile.username || user.email?.split("@")[0] || "user");
        const assignedRole = roles?.[0]?.role;
        setRole(assignedRole ? assignedRole.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : profile.role || "Employee");
        setAvatarUrl(profile.avatar_url);
      }
    };
    loadProfile();
  }, []);

  const initials = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <header className="glass-surface sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/75 px-4 md:px-6">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onToggleSidebar}
        className="lg:hidden"
        aria-label="Toggle navigation"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex flex-col">
        <span className="text-[11px] text-muted-foreground">Workspace</span>
        <h1 className="text-sm font-semibold leading-none">{title}</h1>
      </div>

      {showOrgSwitcher && (
        <div className="ml-3 hidden sm:block">
          <OrgSwitcher />
        </div>
      )}

      <div ref={searchRef} className="relative ml-auto hidden md:block w-full max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={searchInputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search tasks, projects, people…"
          aria-label="Search tasks, projects and people"
          className="h-9 w-full rounded-lg border border-input bg-card/80 pl-9 pr-16 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
        />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          ⌘K
        </kbd>

        {searchOpen && query.trim().length >= 2 && (
          <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
            {results.length === 0 ? (
              <p className="px-3.5 py-4 text-xs text-muted-foreground">No results for “{query.trim()}”.</p>
            ) : (
              <ul className="max-h-80 overflow-y-auto p-1.5">
                {results.map((result, index) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => openResult(result)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${index === highlight ? "bg-accent" : ""}`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                        {kindIcon(result.kind)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{result.title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{result.subtitle}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <Button
        onClick={onNewTask}
        className="primary-lift ml-auto h-9 px-3 text-xs md:ml-0"
      >
        <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New Task</span>
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setDark((v) => !v)}
        className="text-muted-foreground"
        aria-label="Toggle theme"
      >
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>

      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-accent transition"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {initials}
            </div>
          )}
          <div className="hidden md:flex flex-col text-left">
            <span className="text-xs font-medium leading-none">{name}</span>
            <span className="text-[10px] text-muted-foreground leading-none mt-0.5">@{username} · {role}</span>
          </div>
          <ChevronDown className="hidden md:block h-3.5 w-3.5 text-muted-foreground" />
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-card p-1.5 shadow-[var(--shadow-card)]">
              <div className="flex items-center gap-2.5 px-2.5 py-2">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {initials}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{email}</p>
                </div>
              </div>

              <div className="my-1 h-px bg-border" />

              <div className="space-y-1 px-2.5 py-1.5">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <User className="h-3.5 w-3.5" />
                  <span className="truncate">@{username}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Shield className="h-3.5 w-3.5" />
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{role}</span>
                </div>
              </div>

              <div className="my-1 h-px bg-border" />
              <button
                onClick={signOut}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition"
              >
                <LogOut className="h-3.5 w-3.5" /> Log out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
