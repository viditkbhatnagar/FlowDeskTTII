import { Search, Plus, Moon, Sun, Menu, ChevronDown, LogOut, User, UserCog, Shield, CheckSquare, FolderKanban, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { OrgSwitcher } from "@/components/workspace/OrgSwitcher";
import { ProfileDialog } from "@/components/workspace/account/ProfileDialog";
import { signOutEverywhere } from "@/components/workspace/account/session";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-data";
import { useOrganizations } from "@/lib/organizations-data";
import { useTaskSettings } from "@/lib/task-settings-data";
import { cn } from "@/lib/utils";

/** Pages a search result can open, with the dashboardFilter that selects the item. */
export type SearchDestination = "my-tasks" | "team" | "projects";

type SearchResult = {
  key: string;
  kind: "task" | "project" | "person";
  title: string;
  subtitle: string;
  destination: SearchDestination;
  filter: string;
};

type ProjectEntry = { id: string; name: string };

const MIN_QUERY_LENGTH = 2;
const SEARCH_RESULTS_ID = "global-search-results";

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
  onNavigate?: (destination: SearchDestination, filter?: string) => void;
}) {
  const [dark, setDark] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState("Account");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("Member");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { tasks, people, refresh } = useWorkspace();
  const { users } = useOrganizations();
  const { statusLabelFor } = useTaskSettings();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // Below md the search box is hidden; the search icon opens it over the header (FD-053).
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // Real projects, read when the search opens. This used to search the demo list in
  // mock-data.ts, so only invented project names could be found.
  const [projectIndex, setProjectIndex] = useState<ProjectEntry[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileSearchButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!searchOpen) return;
    let active = true;
    void supabase
      .from("work_projects")
      .select("id, name")
      .is("archived_at", null)
      .order("name")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("[search] Could not load projects", error);
          return;
        }
        setProjectIndex(data ?? []);
      });
    return () => {
      active = false;
    };
  }, [searchOpen]);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < MIN_QUERY_LENGTH) return [];
    const matches = (text: string | undefined | null) => Boolean(text?.toLowerCase().includes(q));

    // Opening a task goes through My Tasks, which can show any workspace task (FD-029).
    const taskResults: SearchResult[] = tasks
      .filter((t) => matches(t.title) || matches(t.project) || matches(t.assignee?.name) || t.tags?.some((tag) => matches(tag)))
      .slice(0, 5)
      .map((t) => ({
        key: `task-${t.id}`,
        kind: "task",
        title: t.title,
        // In the task's own organization's words.
        subtitle: ["Task", t.project, statusLabelFor(t.status, t.organizationId)]
          .filter(Boolean)
          .join(" · "),
        destination: "my-tasks",
        filter: `task:${t.id}`,
      }));

    const projectResults: SearchResult[] = projectIndex
      .filter((p) => matches(p.name))
      .slice(0, 4)
      .map((p) => ({
        key: `project-${p.id}`,
        kind: "project",
        title: p.name,
        subtitle: "Project",
        destination: "projects",
        // By id: two organizations can each have a project with the same name.
        filter: `project:${p.id}`,
      }));

    // People come from the organization directory (with email and designation) and
    // from every profile the workspace can see, so task owners outside the directory
    // are findable too. "Maya" and "test" used to find nobody (FD-028).
    const seen = new Set<string>();
    const directory = [
      ...users.map((u) => ({ id: u.id, name: u.name, email: u.email, designation: u.designation })),
      ...people.map((p) => ({ id: p.id, name: p.name, email: "", designation: "" })),
    ].filter((person) => {
      if (!person.id || seen.has(person.id)) return false;
      seen.add(person.id);
      return true;
    });
    const peopleResults: SearchResult[] = directory
      .filter((person) => matches(person.name) || matches(person.email) || matches(person.designation))
      .slice(0, 4)
      .map((person) => ({
        key: `person-${person.id}`,
        kind: "person",
        title: person.name,
        subtitle: person.designation ? `Person · ${person.designation}` : person.email ? `Person · ${person.email}` : "Person",
        destination: "team",
        filter: `assignee:${person.id}`,
      }));

    return [...taskResults, ...projectResults, ...peopleResults];
  }, [query, tasks, projectIndex, users, people, statusLabelFor]);

  const closeSearch = () => {
    setSearchOpen(false);
    setMobileSearchOpen(false);
  };

  /** Escape or the close button: on phones, hand focus back to the search icon that opened it. */
  const dismissSearch = () => {
    const wasOverlay = mobileSearchOpen;
    closeSearch();
    if (wasOverlay) mobileSearchButtonRef.current?.focus();
    else searchInputRef.current?.blur();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMobileSearchOpen(true);
        setSearchOpen(true);
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) closeSearch();
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // The input is display:none until the overlay renders, so focus it afterwards.
  useEffect(() => {
    if (mobileSearchOpen) searchInputRef.current?.focus();
  }, [mobileSearchOpen]);

  useEffect(() => setHighlight(0), [results.length]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  const openResult = (result: SearchResult) => {
    closeSearch();
    setQuery("");
    searchInputRef.current?.blur();
    // Was onNavigate(page) alone: the task, project or person was never opened (FD-029).
    onNavigate?.(result.destination, result.filter);
  };

  const onSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      dismissSearch();
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
    kind === "task" ? <CheckSquare className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : kind === "project" ? <FolderKanban className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : <Users className="h-3.5 w-3.5 text-primary" aria-hidden="true" />;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
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
    setMenuOpen(false);
    await queryClient.cancelQueries();
    queryClient.clear();
    await signOutEverywhere();
    await navigate({ to: "/auth", replace: true });
  };

  const showResults = searchOpen && query.trim().length >= MIN_QUERY_LENGTH;
  const activeResult = showResults ? results[highlight] : undefined;

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
        <Menu className="h-5 w-5" aria-hidden="true" />
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

      <div
        ref={searchRef}
        role="search"
        className={cn(
          "ml-auto w-full max-w-md md:relative md:block",
          mobileSearchOpen
            ? "absolute inset-x-0 top-0 z-50 flex h-16 max-w-none items-center gap-2 border-b border-border bg-background px-4 md:inset-auto md:z-auto md:h-auto md:max-w-md md:border-0 md:bg-transparent md:px-0"
            : "relative hidden",
        )}
      >
        <div className="relative w-full flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
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
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showResults}
            aria-controls={SEARCH_RESULTS_ID}
            aria-activedescendant={activeResult ? `${SEARCH_RESULTS_ID}-${activeResult.key}` : undefined}
            className="h-9 w-full rounded-lg border border-input bg-card/80 pl-9 pr-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 md:pr-16"
          />
          <kbd className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground md:block" aria-hidden="true">
            ⌘K
          </kbd>

          {showResults && (
            <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
              {results.length === 0 ? (
                <p className="px-3.5 py-4 text-xs text-muted-foreground" role="status">No results for “{query.trim()}”.</p>
              ) : (
                <ul id={SEARCH_RESULTS_ID} role="listbox" aria-label="Search results" className="max-h-80 overflow-y-auto p-1.5">
                  {results.map((result, index) => (
                    <li
                      key={result.key}
                      id={`${SEARCH_RESULTS_ID}-${result.key}`}
                      role="option"
                      aria-selected={index === highlight}
                      onMouseEnter={() => setHighlight(index)}
                      // Keep focus in the input so the list does not close before the click lands.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => openResult(result)}
                      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${index === highlight ? "bg-accent" : ""}`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
                        {kindIcon(result.kind)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{result.title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{result.subtitle}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {mobileSearchOpen && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={dismissSearch}
            className="shrink-0 text-muted-foreground md:hidden"
            aria-label="Close search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      <Button
        ref={mobileSearchButtonRef}
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => {
          setMobileSearchOpen(true);
          setSearchOpen(true);
        }}
        className="ml-auto text-muted-foreground md:hidden"
        aria-label="Search"
        aria-expanded={mobileSearchOpen}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </Button>

      <Button
        type="button"
        onClick={onNewTask}
        className="primary-lift h-9 px-3 text-xs"
        // The text is hidden on phones, which left an unnamed "+" button (FD-054).
        aria-label="New task"
      >
        <Plus className="h-4 w-4" aria-hidden="true" /> <span className="hidden sm:inline">New Task</span>
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setDark((v) => !v)}
        className="text-muted-foreground"
        aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      >
        {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
      </Button>

      <div className="relative">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-accent transition"
          aria-label={`Account menu for ${name}`}
          aria-expanded={menuOpen}
          aria-controls="account-menu"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground" aria-hidden="true">
              {initials}
            </div>
          )}
          <div className="hidden md:flex flex-col text-left">
            <span className="text-xs font-medium leading-none">{name}</span>
            <span className="text-[10px] text-muted-foreground leading-none mt-0.5">@{username} · {role}</span>
          </div>
          <ChevronDown className="hidden md:block h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
            <div id="account-menu" className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-card p-1.5 shadow-[var(--shadow-card)]">
              <div className="flex items-center gap-2.5 px-2.5 py-2">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground" aria-hidden="true">
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
                  <User className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="truncate">@{username}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{role}</span>
                </div>
              </div>

              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setProfileOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium hover:bg-accent transition"
              >
                <UserCog className="h-3.5 w-3.5" aria-hidden="true" /> Profile &amp; password
              </button>
              <button
                type="button"
                onClick={signOut}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Log out
              </button>
            </div>
          </>
        )}
      </div>

      <ProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        userId={userId}
        email={email}
        name={name}
        onNameSaved={(savedName) => {
          setName(savedName);
          // Task cards and pickers show the name from the workspace data; reload it.
          void refresh();
        }}
      />
    </header>
  );
}
