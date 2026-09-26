import { useId, useMemo, useState } from "react";
import {
  Plus, MoreHorizontal, Eye, Pencil, Ban, ArrowLeft, Mail, Phone, Search,
  CheckCircle2, Trash2, Building2, Shield, CalendarDays, X, Loader2, Send,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useOrganizations, validatePhone, plural, PHONE_RULES,
  type AdminRpcError, type Department, type Membership, type OrgStatus, type OrgUser,
  type Organization, type Team,
} from "@/lib/organizations-data";
import { useWorkspace } from "@/lib/workspace-data";
import { todayIn } from "@/lib/today";

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20";
const labelClass = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const sectionClass = "text-xs font-semibold tracking-tight text-foreground";

function initialsOf(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function UserAvatar({ user, size = 32 }: { user: OrgUser; size?: number }) {
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={`${user.name} profile photo`}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
      style={{ width: size, height: size }}
    >
      {initialsOf(user.name)}
    </div>
  );
}

function StatusPill({ status }: { status: OrgStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        status === "active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      {status === "active" ? "Active" : "Inactive"}
    </span>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <div className={labelClass}>{label}</div>
      <div className="text-sm">{value && value.trim() ? value : "—"}</div>
    </div>
  );
}

export function UsersPage() {
  const {
    status, users, organizations, departments, teams, roles, rolesFor, canManageUsers, setUserStatus,
    currentUser,
  } = useOrganizations();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerUser, setDrawerUser] = useState<OrgUser | "new" | null>(null);
  const [deactivateUser, setDeactivateUser] = useState<OrgUser | null>(null);

  const [query, setQuery] = useState("");
  const [orgFilter, setOrgFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const multiOrg = organizations.length > 1;
  const orgName = (id: string) => organizations.find((o) => o.id === id)?.name ?? "—";
  const deptName = (id?: string) => departments.find((d) => d.id === id)?.name ?? "—";
  const teamName = (id?: string) => teams.find((t) => t.id === id)?.name ?? "—";
  const visibleMemberships = (user: OrgUser) =>
    user.memberships.filter((m) => organizations.some((o) => o.id === m.orgId));

  const filterDepartments = useMemo(
    () => (orgFilter === "all" ? departments : departments.filter((d) => d.orgId === orgFilter)),
    [departments, orgFilter],
  );
  const filterTeams = useMemo(
    () =>
      deptFilter !== "all"
        ? teams.filter((t) => t.departmentId === deptFilter)
        : orgFilter === "all"
          ? teams
          : teams.filter((t) => t.orgId === orgFilter),
    [teams, deptFilter, orgFilter],
  );
  // Real role names, once each. Was a hardcoded Admin / Manager / Member / Viewer
  // list that matched none of the database's roles (FD-037).
  const filterRoles = useMemo(() => {
    const scoped = orgFilter === "all" ? roles : rolesFor(orgFilter);
    return [...new Set(scoped.map((r) => r.name))];
  }, [roles, rolesFor, orgFilter]);

  // Everyone in the chosen organization. The header totals use this, so with an
  // organization picked they equal that organization's Users on Organizations.
  const scopedUsers = useMemo(
    () =>
      orgFilter === "all" ? users : users.filter((u) => u.memberships.some((m) => m.orgId === orgFilter)),
    [users, orgFilter],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scopedUsers.filter((u) => {
      if (
        q &&
        !u.name.toLowerCase().includes(q) &&
        !u.email.toLowerCase().includes(q) &&
        !(u.employeeId ?? "").toLowerCase().includes(q)
      )
        return false;
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      const scope =
        orgFilter === "all"
          ? u.memberships
          : u.memberships.filter((m) => m.orgId === orgFilter);
      // People with no organization assignment used to be dropped from the list
      // while still counted in Total Users (FD-037).
      if (deptFilter !== "all" && !scope.some((m) => m.departmentId === deptFilter)) return false;
      if (teamFilter !== "all" && !scope.some((m) => m.teamId === teamFilter)) return false;
      if (roleFilter !== "all" && !scope.some((m) => m.role === roleFilter)) return false;
      return true;
    });
  }, [scopedUsers, query, statusFilter, orgFilter, deptFilter, teamFilter, roleFilter]);

  const selected = users.find((u) => u.id === selectedId) ?? null;

  if (selected) {
    return (
      <>
        <UserDetail
          user={selected}
          onBack={() => setSelectedId(null)}
          onEdit={() => setDrawerUser(selected)}
          onDeactivate={() => setDeactivateUser(selected)}
        />
        <UserDrawer target={drawerUser} onClose={() => setDrawerUser(null)} />
        <DeactivateDialog user={deactivateUser} onClose={() => setDeactivateUser(null)} />
      </>
    );
  }

  const total = scopedUsers.length;
  const active = scopedUsers.filter((u) => u.status === "active").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Users</h2>
          <p className="text-sm text-muted-foreground">
            Manage employees and their access to the workspace.
          </p>
        </div>
        {canManageUsers && (
          <button
            onClick={() => setDrawerUser("new")}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Add User
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span>
          Total Users <span className="font-semibold text-foreground">{total}</span>
        </span>
        <span className="h-3 w-px bg-border" />
        <span>
          Active <span className="font-semibold text-foreground">{active}</span>
        </span>
        <span className="h-3 w-px bg-border" />
        <span>
          Inactive <span className="font-semibold text-foreground">{total - active}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Search users"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users"
            className={cn(inputClass, "w-56 pl-8")}
          />
        </div>
        {/* With one organization "All Organizations" and its name were the same
            filter twice (FD-051). */}
        {multiOrg && (
          <select
            aria-label="Filter by organization"
            value={orgFilter}
            onChange={(e) => {
              setOrgFilter(e.target.value);
              setDeptFilter("all");
              setTeamFilter("all");
              setRoleFilter("all");
            }}
            className={cn(inputClass, "w-48")}
          >
            <option value="all">All Organizations</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}
        <select
          aria-label="Filter by department"
          value={deptFilter}
          onChange={(e) => {
            setDeptFilter(e.target.value);
            setTeamFilter("all");
          }}
          className={cn(inputClass, "w-44")}
        >
          <option value="all">All Departments</option>
          <GroupedOptions
            items={filterDepartments}
            groupOf={(d) => (multiOrg && orgFilter === "all" ? orgName(d.orgId) : null)}
          />
        </select>
        <select
          aria-label="Filter by team"
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className={cn(inputClass, "w-40")}
        >
          <option value="all">All Teams</option>
          <GroupedOptions
            items={filterTeams}
            groupOf={(t) => (deptFilter === "all" ? deptName(t.departmentId) : null)}
          />
        </select>
        <select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className={cn(inputClass, "w-36")}
        >
          <option value="all">All Roles</option>
          {filterRoles.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={cn(inputClass, "w-32")}
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Employee ID</th>
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium">Department</th>
                <th className="px-4 py-3 font-medium">Team</th>
                <th className="px-4 py-3 font-medium">Designation</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const scoped =
                  (orgFilter !== "all" && user.memberships.find((m) => m.orgId === orgFilter)) ||
                  user.memberships.find((m) => m.orgId === user.primaryOrgId) ||
                  user.memberships[0];
                // Only organizations this viewer can actually see, and never with a
                // single organization ("upCarrera +1" with one org, FD-051).
                const extra = multiOrg ? visibleMemberships(user).length - 1 : 0;
                return (
                  <tr
                    key={user.id}
                    className="border-b border-border/60 transition last:border-0 hover:bg-accent/50"
                  >
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelectedId(user.id)}
                        className="flex items-center gap-3 text-left"
                      >
                        <UserAvatar user={user} />
                        <span>
                          <span className="block font-medium">{user.name}</span>
                          <span className="block text-xs text-muted-foreground">{user.email}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{user.employeeId ?? "—"}</td>
                    <td className="px-4 py-3">
                      {scoped ? (
                        orgName(scoped.orgId)
                      ) : (
                        <span className="text-muted-foreground">Not assigned</span>
                      )}
                      {extra > 0 && orgFilter === "all" && (
                        <span
                          className="ml-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          title={plural(extra, "more organization")}
                        >
                          +{extra}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{deptName(scoped?.departmentId)}</td>
                    <td className="px-4 py-3">{teamName(scoped?.teamId)}</td>
                    <td className="px-4 py-3">{user.designation || "—"}</td>
                    <td className="px-4 py-3">{scoped?.role ?? "—"}</td>
                    <td className="px-4 py-3"><StatusPill status={user.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                            aria-label={`Actions for ${user.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => setSelectedId(user.id)}>
                            <Eye className="mr-2 h-3.5 w-3.5" /> View
                          </DropdownMenuItem>
                          {canManageUsers && (
                            <DropdownMenuItem onClick={() => setDrawerUser(user)}>
                              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                            </DropdownMenuItem>
                          )}
                          {/* Nobody switches their own account off or on. */}
                          {canManageUsers && user.id !== currentUser?.id &&
                            (user.status === "active" ? (
                              <DropdownMenuItem onClick={() => setDeactivateUser(user)}>
                                <Ban className="mr-2 h-3.5 w-3.5" /> Deactivate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => {
                                  void setUserStatus(user.id, "active").then((saved) => {
                                    if (saved) toast.success(`${user.name} activated`);
                                  });
                                }}
                              >
                                <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Activate
                              </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {status === "loading"
                      ? "Loading users…"
                      : status === "error"
                        ? "Users could not be loaded. Refresh to try again."
                        : "No users match these filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <UserDrawer target={drawerUser} onClose={() => setDrawerUser(null)} />
      <DeactivateDialog user={deactivateUser} onClose={() => setDeactivateUser(null)} />
      {/* Was "{first organization's count} users indexed", which disagreed with the
          total above whenever a second organization existed (FD-037). */}
      <div className="sr-only" role="status">
        Showing {filtered.length} of {plural(total, "user")}
      </div>
    </div>
  );
}

/** Options, grouped under a heading when groupOf returns one — so two departments
 *  called "Operations" in different organizations no longer look like a duplicate. */
function GroupedOptions<T extends { id: string; name: string }>({
  items, groupOf,
}: { items: T[]; groupOf: (item: T) => string | null }) {
  const groups = new Map<string | null, T[]>();
  for (const item of items) {
    const key = groupOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  if (groups.size <= 1 && !groups.has(null) && items.length) {
    // One heading only: no need to group.
    return <>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</>;
  }
  return (
    <>
      {[...groups.entries()].map(([group, list]) =>
        group ? (
          <optgroup key={group} label={group}>
            {list.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </optgroup>
        ) : (
          list.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)
        ),
      )}
    </>
  );
}

/* ---------------------------------- drawer --------------------------------- */

type DraftMembership = {
  orgId: string;
  departmentId: string;
  teamId: string;
  role: string;
  reportingManagerId: string;
};

const blankDraft = (role: string): DraftMembership => ({
  orgId: "", departmentId: "", teamId: "", role, reportingManagerId: "",
});

/**
 * One organization assignment. This was declared inside UserDrawer, so React saw
 * a brand-new component on every keystroke and remounted every field.
 */
function AssignmentFields({
  value, onChange, allowRole = true, lockOrganization = false, organizations, departments, teams,
  users, roleNames, defaultRoleFor,
}: {
  value: DraftMembership;
  onChange: (next: DraftMembership) => void;
  allowRole?: boolean;
  lockOrganization?: boolean;
  organizations: Organization[];
  departments: Department[];
  teams: Team[];
  users: OrgUser[];
  roleNames: (orgId: string, current?: string) => string[];
  defaultRoleFor: (orgId: string) => string;
}) {
  const id = useId();
  const managerOptions = [...users].sort((a, b) => {
    const aIn = a.memberships.some((m) => m.orgId === value.orgId) ? 0 : 1;
    const bIn = b.memberships.some((m) => m.orgId === value.orgId) ? 0 : 1;
    return aIn - bIn || a.name.localeCompare(b.name);
  });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <label htmlFor={`${id}-org`} className={labelClass}>Organization</label>
        <select
          id={`${id}-org`}
          value={value.orgId}
          onChange={(e) =>
            onChange({
              ...value,
              orgId: e.target.value,
              departmentId: "",
              teamId: "",
              reportingManagerId: "",
              role: defaultRoleFor(e.target.value),
            })
          }
          className={inputClass}
          disabled={lockOrganization}
        >
          <option value="">Select organization</option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-dept`} className={labelClass}>Department</label>
        <select
          id={`${id}-dept`}
          value={value.departmentId}
          onChange={(e) => onChange({ ...value, departmentId: e.target.value, teamId: "" })}
          className={inputClass}
          disabled={!value.orgId}
        >
          <option value="">Select department</option>
          {departments
            .filter((d) => d.orgId === value.orgId && (d.status === "active" || d.id === value.departmentId))
            .map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-team`} className={labelClass}>Team</label>
        <select
          id={`${id}-team`}
          value={value.teamId}
          onChange={(e) => onChange({ ...value, teamId: e.target.value })}
          className={inputClass}
          disabled={!value.departmentId}
        >
          <option value="">No team</option>
          {teams.filter((t) => t.departmentId === value.departmentId).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${id}-manager`} className={labelClass}>Reporting Manager</label>
        <select
          id={`${id}-manager`}
          value={value.reportingManagerId}
          onChange={(e) => onChange({ ...value, reportingManagerId: e.target.value })}
          className={inputClass}
          disabled={!value.orgId}
        >
          <option value="">No manager</option>
          {managerOptions.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.memberships.some((m) => m.orgId === value.orgId) ? "" : " (other organization)"}
            </option>
          ))}
        </select>
      </div>
      {allowRole && (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-role`} className={labelClass}>Role</label>
          <select
            id={`${id}-role`}
            value={value.role}
            onChange={(e) => onChange({ ...value, role: e.target.value })}
            className={inputClass}
            disabled={!value.orgId}
          >
            {roleNames(value.orgId, value.role).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

/** The role names offered in an organization: active roles, plus the current one if it is not. */
function useRoleChoices() {
  const { rolesFor, defaultRoleName } = useOrganizations();
  const roleNames = (orgId: string, current?: string) => {
    const names = rolesFor(orgId).filter((r) => r.status === "active").map((r) => r.name);
    const withCurrent = current && !names.includes(current) ? [current, ...names] : names;
    return withCurrent.length ? withCurrent : [defaultRoleName(orgId)];
  };
  return { roleNames, defaultRoleFor: defaultRoleName };
}

/**
 * Which field a refusal from admin_create_user belongs to, so it shows next to
 * that field instead of in a toast. The function's messages name the field.
 */
function userErrorField(error: AdminRpcError): string | null {
  if (error.code === "23505") return "email";
  if (error.code !== "22023") return null;
  const message = error.message.toLowerCase();
  if (message.includes("email")) return "email";
  if (message.includes("employee id")) return "employeeId";
  if (message.includes("designation")) return "designation";
  if (message.includes("phone")) return "phone";
  if (message.includes("joining")) return "joiningDate";
  if (message.includes("manager")) return "manager";
  if (message.includes("department") || message.includes("team")) return "dept";
  if (message.includes("role")) return "role";
  if (message.includes("name")) return "name";
  if (message.includes("organization")) return "org";
  return null;
}

function UserDrawer({ target, onClose }: { target: OrgUser | "new" | null; onClose: () => void }) {
  const {
    organizations,
    departments,
    teams,
    users,
    updateUser,
    isEmailTaken,
    logUserActivity,
    isAdminIn,
    roleGrantsAdmin,
    soleAdminOrgIds,
    createUser,
    currentUser,
    activeOrgId,
  } = useOrganizations();
  const { refresh: refreshPeople } = useWorkspace();
  const { roleNames, defaultRoleFor } = useRoleChoices();
  const isNew = target === "new";
  const existing = target && target !== "new" ? target : null;
  // Nobody can switch their own account off (or back on); the database ignores it.
  const editingSelf = !!existing && existing.id === currentUser?.id;
  const orgNameOf = (id: string) =>
    organizations.find((o) => o.id === id)?.name ?? "this organization";
  const fieldId = useId();
  const [submitting, setSubmitting] = useState(false);
  // A new account's first organization must be one the caller administers:
  // the server refuses any other.
  const adminOrganizations = currentUser
    ? organizations.filter((o) => isAdminIn(currentUser, o.id))
    : organizations;
  const firstOrgFor = () =>
    adminOrganizations.find((o) => o.id === activeOrgId)?.id ??
    (adminOrganizations.length === 1 ? adminOrganizations[0].id : "");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [designation, setDesignation] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [status, setStatus] = useState<OrgStatus>("active");
  const [primary, setPrimary] = useState<DraftMembership>(blankDraft("Employee"));
  const [additional, setAdditional] = useState<DraftMembership[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [seed, setSeed] = useState<string | null>(null);

  // Sync form to the target when the drawer opens for a different user.
  const key = existing?.id ?? (isNew ? "new" : "");
  if (target && seed !== key) {
    setSeed(key);
    setErrors({});
    setPhoneTouched(false);
    if (existing) {
      const primaryMembership =
        existing.memberships.find((m) => m.orgId === existing.primaryOrgId) ?? existing.memberships[0];
      const primaryOrgId = existing.primaryOrgId || primaryMembership?.orgId || "";
      setName(existing.name);
      setEmail(existing.email);
      setPhone(existing.phone ?? "");
      setAvatarUrl(existing.avatarUrl ?? "");
      setEmployeeId(existing.employeeId ?? "");
      setDesignation(existing.designation);
      setJoiningDate(existing.joiningDate ?? "");
      setStatus(existing.status);
      setPrimary({
        orgId: primaryOrgId,
        departmentId: primaryMembership?.departmentId ?? "",
        teamId: primaryMembership?.teamId ?? "",
        role: primaryMembership?.role ?? defaultRoleFor(primaryOrgId),
        reportingManagerId: primaryMembership?.reportingManagerId ?? "",
      });
      setAdditional(
        existing.memberships
          .filter((m) => m.orgId !== primaryOrgId)
          .map((m) => ({
            orgId: m.orgId,
            departmentId: m.departmentId ?? "",
            teamId: m.teamId ?? "",
            role: m.role,
            reportingManagerId: m.reportingManagerId ?? "",
          })),
      );
    } else {
      setName(""); setEmail(""); setPhone(""); setAvatarUrl(""); setEmployeeId("");
      setDesignation(""); setJoiningDate(""); setStatus("active");
      const orgId = firstOrgFor();
      setPrimary({ ...blankDraft(orgId ? defaultRoleFor(orgId) : "Employee"), orgId });
      setAdditional([]);
    }
  }

  // Forget the form on close, so the next Add User starts empty instead of
  // showing the person just added.
  const close = () => {
    if (submitting) return;
    setSeed(null);
    onClose();
  };

  /** A message goes as soon as its field is edited, instead of lingering until the next submit. */
  const clearErrors = (...keys: string[]) =>
    setErrors((current) =>
      keys.some((key) => key in current)
        ? Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key)))
        : current,
    );

  const phoneError = validatePhone(phone);
  // Invalid characters show at once; length only once the field is left (FD-050).
  const showPhoneError =
    !!phoneError && (phoneTouched || /[^0-9+\-() ]/.test(phone) || !!errors.phone);

  const toMembership = (draft: DraftMembership): Membership => ({
    orgId: draft.orgId,
    departmentId: draft.departmentId || undefined,
    teamId: draft.teamId || undefined,
    role: draft.role || defaultRoleFor(draft.orgId),
    status: "active",
    reportingManagerId: draft.reportingManagerId || undefined,
  });

  /**
   * Add User for someone with no account: the server creates the login and the
   * first membership and queues the welcome email with a link to choose a
   * password. Additional organizations are added once the account exists.
   */
  const createAccount = async () => {
    setSubmitting(true);
    const trimmedEmail = email.trim();
    const result = await createUser({
      name: name.trim(),
      email: trimmedEmail,
      phone: phone.trim() || undefined,
      avatarUrl: avatarUrl.trim() || undefined,
      employeeId: employeeId.trim() || undefined,
      designation: designation.trim(),
      joiningDate: joiningDate || undefined,
      primary: toMembership(primary),
      additional: additional.map(toMembership),
    });
    setSubmitting(false);
    if (!result.ok) {
      const field = userErrorField(result.error);
      if (field) setErrors({ [field]: result.error.message });
      else toast.error(result.error.message);
      return;
    }
    void refreshPeople();
    toast.success(`Welcome email on its way to ${trimmedEmail}`);
    setSeed(null);
    onClose();
  };

  const submit = () => {
    if (submitting) return;
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Full name is required";
    if (!email.trim()) next.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = "Enter a valid email";
    else if (isEmailTaken(email, existing?.id)) next.email = "This email already has an account";
    if (phoneError) next.phone = phoneError;
    if (avatarUrl.trim() && !/^https?:\/\/\S+$/i.test(avatarUrl.trim()))
      next.avatarUrl = "Use a link that starts with https://";
    if (!designation.trim()) next.designation = "Designation is required";
    if (!primary.orgId) next.org = "Primary organization is required";
    if (!primary.departmentId) next.dept = "Department is required";
    if (!primary.role) next.role = "Role is required";
    if (additional.some((a) => !a.orgId || !a.departmentId))
      next.additional = "Each additional access needs an organization and department";
    if (new Set([primary.orgId, ...additional.map((a) => a.orgId)]).size !== additional.length + 1)
      next.additional = "An organization can only be assigned once";
    if (isNew) {
      // The server checks these too; saying so here saves a round trip.
      const orgHasDepartments = departments.some(
        (d) => d.orgId === primary.orgId && d.status === "active",
      );
      if (primary.orgId && !orgHasDepartments) {
        next.dept = "This organization has no departments yet. Add one in Teams & Departments first.";
      }
      const manager = users.find((u) => u.id === primary.reportingManagerId);
      const managerInOrg = manager?.memberships.some(
        (m) => m.orgId === primary.orgId && m.status === "active",
      );
      if (manager && !managerInOrg) {
        next.manager = "Choose a reporting manager from this organization";
      }
    }
    setErrors(next);
    setPhoneTouched(true);
    if (Object.keys(next).length > 0) return;
    if (!existing) {
      void createAccount();
      return;
    }

    // A membership keeps the status it has: this form has no control for it,
    // and a deactivated person's memberships are off until Reactivate. It used
    // to send "active" for every one, so saving a deactivated person's details
    // switched their access back on.
    const statusIn = (orgId: string): OrgStatus =>
      existing.memberships.find((m) => m.orgId === orgId)?.status ?? "active";
    const memberships: Membership[] = [
      {
        orgId: primary.orgId,
        departmentId: primary.departmentId || undefined,
        teamId: primary.teamId || undefined,
        role: primary.role,
        status: statusIn(primary.orgId),
        reportingManagerId: primary.reportingManagerId || undefined,
      },
      ...additional.map<Membership>((a) => ({
        orgId: a.orgId,
        departmentId: a.departmentId || undefined,
        teamId: a.teamId || undefined,
        role: a.role,
        status: statusIn(a.orgId),
        reportingManagerId: a.reportingManagerId || undefined,
      })),
    ];

    // Every organization keeps an active admin; the database refuses otherwise.
    // Counted by the admin permission itself, not the role's name: a sole admin
    // whose membership reads "Employee" is still the admin, and saving them
    // unchanged would take it away (saving writes the permission the role shows).
    const soleAdminOf = soleAdminOrgIds(existing);
    if (status !== "active" && soleAdminOf.length) {
      setErrors({
        status: `${existing.name} is the last active admin of ${orgNameOf(soleAdminOf[0])}. Make someone else admin first.`,
      });
      return;
    }
    const demoted = soleAdminOf.find((orgId) => {
      const after = memberships.find((m) => m.orgId === orgId);
      return !after || !roleGrantsAdmin(orgId, after.role);
    });
    if (demoted) {
      const before = existing.memberships.find((m) => m.orgId === demoted);
      const after = memberships.find((m) => m.orgId === demoted);
      const unchangedRole = before && after && before.role === after.role ? before.role : null;
      const message = unchangedRole
        ? `Their role in ${orgNameOf(demoted)} reads ${unchangedRole}, but they hold the admin permission there and are its only active admin, so saving would take it away. Choose an admin role for them, or make someone else admin first.`
        : `There must always be at least one active admin in ${orgNameOf(demoted)}. Make someone else admin first.`;
      // Next to the role it is about: the primary's, or the additional access list.
      setErrors({ [demoted === primary.orgId ? "role" : "additional"]: message });
      return;
    }

    const savedName = name.trim();
    void updateUser(existing.id, {
      name: name.trim(),
      email: email.trim(),
      // An emptied field is sent as "" so it is cleared, not left as it was.
      phone: phone.trim(),
      avatarUrl: avatarUrl.trim(),
      employeeId: employeeId.trim(),
      designation: designation.trim(),
      joiningDate,
      status,
      memberships,
    }).then((saved) => {
      // A refused save has already said why, and the list shows what is stored.
      if (!saved) return;
      logUserActivity(existing.id, "updated", "User details updated");
      toast.success(`${savedName} updated`);
    });
    close();
  };

  const assignmentProps = {
    // New people can only be given organizations the caller administers.
    organizations: isNew ? adminOrganizations : organizations,
    departments, teams, users, roleNames, defaultRoleFor,
  };

  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && close()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{existing ? "Edit User" : "Add User"}</SheetTitle>
          <SheetDescription>
            Employee identity, organization assignment, and system access.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {isNew && (
            <div className="flex gap-2 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2.5 text-xs text-foreground/80">
              <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <p>They'll get a welcome email from Flowdesk with a link to choose their password.</p>
            </div>
          )}

          <section className="space-y-3">
            <div className={sectionClass}>Personal</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor={`${fieldId}-name`} className={labelClass}>Full Name *</label>
                <input id={`${fieldId}-name`} value={name} onChange={(e) => { setName(e.target.value); clearErrors("name"); }} className={inputClass} placeholder="Full name" />
                {errors.name && <p className="text-[11px] text-destructive">{errors.name}</p>}
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${fieldId}-email`} className={labelClass}>Email *</label>
                <input
                  id={`${fieldId}-email`}
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearErrors("email");
                  }}
                  className={cn(inputClass, errors.email && "border-destructive")}
                  placeholder="name@company.com"
                  aria-invalid={!!errors.email || undefined}
                  disabled={!!existing}
                  title={existing ? "The sign-in email can't be changed here." : undefined}
                />
                {errors.email && <p className="text-[11px] text-destructive">{errors.email}</p>}
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${fieldId}-phone`} className={labelClass}>Phone</label>
                <input
                  id={`${fieldId}-phone`}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={PHONE_RULES.maxLength}
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); clearErrors("phone"); }}
                  onBlur={() => setPhoneTouched(true)}
                  className={cn(inputClass, showPhoneError && "border-destructive")}
                  placeholder="+971 50 000 0000"
                  aria-invalid={showPhoneError || undefined}
                  aria-describedby={showPhoneError ? `${fieldId}-phone-error` : undefined}
                />
                {(showPhoneError || errors.phone) && (
                  <p id={`${fieldId}-phone-error`} className="text-[11px] text-destructive">
                    {showPhoneError ? phoneError : errors.phone}
                  </p>
                )}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor={`${fieldId}-avatar`} className={labelClass}>Profile Photo URL</label>
                <input
                  id={`${fieldId}-avatar`}
                  value={avatarUrl}
                  onChange={(e) => { setAvatarUrl(e.target.value); clearErrors("avatarUrl"); }}
                  className={cn(inputClass, errors.avatarUrl && "border-destructive")}
                  placeholder="https://"
                />
                {errors.avatarUrl && (
                  <p className="text-[11px] text-destructive">{errors.avatarUrl}</p>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className={sectionClass}>Work</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor={`${fieldId}-employee`} className={labelClass}>Employee ID</label>
                <input id={`${fieldId}-employee`} value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); clearErrors("employeeId"); }} className={inputClass} />
                {errors.employeeId && (
                  <p className="text-[11px] text-destructive">{errors.employeeId}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${fieldId}-designation`} className={labelClass}>Designation *</label>
                <input id={`${fieldId}-designation`} value={designation} onChange={(e) => { setDesignation(e.target.value); clearErrors("designation"); }} className={inputClass} />
                {errors.designation && <p className="text-[11px] text-destructive">{errors.designation}</p>}
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${fieldId}-joining`} className={labelClass}>Joining Date</label>
                <input id={`${fieldId}-joining`} type="date" value={joiningDate} onChange={(e) => { setJoiningDate(e.target.value); clearErrors("joiningDate"); }} className={inputClass} />
                {errors.joiningDate && (
                  <p className="text-[11px] text-destructive">{errors.joiningDate}</p>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className={sectionClass}>Organization Assignment</div>
            {/* The primary organization of an existing account is not moved from here:
                moving it means removing their access to the old one. */}
            <AssignmentFields
              value={primary}
              onChange={(next) => { setPrimary(next); clearErrors("org", "dept", "manager", "role"); }}
              allowRole={false}
              lockOrganization={!!existing}
              {...assignmentProps}
            />
            {(errors.org || errors.dept || errors.manager) && (
              <p className="text-[11px] text-destructive">{errors.org ?? errors.dept ?? errors.manager}</p>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className={sectionClass}>Additional Organization Access</div>
              <button
                onClick={() => setAdditional((c) => [...c, blankDraft("")])}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] hover:bg-accent"
              >
                <Plus className="h-3 w-3" /> Add Organization
              </button>
            </div>
            {additional.length === 0 && (
              <p className="text-xs text-muted-foreground">
                One account, one login. Add more organizations instead of creating a second user.
              </p>
            )}
            {additional.map((item, index) => (
              <div key={index} className="relative space-y-3 rounded-xl border border-border p-3">
                <button
                  onClick={() => setAdditional((c) => c.filter((_, i) => i !== index))}
                  className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Remove organization access"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <AssignmentFields
                  value={item}
                  onChange={(next) => {
                    setAdditional((c) => c.map((v, i) => (i === index ? next : v)));
                    clearErrors("additional");
                  }}
                  {...assignmentProps}
                />
              </div>
            ))}
            {errors.additional && <p className="text-[11px] text-destructive">{errors.additional}</p>}
          </section>

          <section className="space-y-3">
            <div className={sectionClass}>System Access</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor={`${fieldId}-role`} className={labelClass}>Role *</label>
                <select
                  id={`${fieldId}-role`}
                  value={primary.role}
                  onChange={(e) => { setPrimary({ ...primary, role: e.target.value }); clearErrors("role"); }}
                  className={inputClass}
                  disabled={!primary.orgId}
                >
                  {roleNames(primary.orgId, primary.role).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {errors.role && <p className="text-[11px] text-destructive">{errors.role}</p>}
              </div>
              {/* A new account starts active: it is created to be used. */}
              {existing && (
                <div className="space-y-1.5">
                  <label htmlFor={`${fieldId}-status`} className={labelClass}>Status</label>
                  <select
                    id={`${fieldId}-status`}
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value as OrgStatus);
                      clearErrors("status");
                    }}
                    className={inputClass}
                    disabled={editingSelf}
                    aria-describedby={editingSelf ? `${fieldId}-status-note` : undefined}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  {editingSelf && (
                    <p id={`${fieldId}-status-note`} className="text-[11px] text-muted-foreground">
                      You can't change your own account status.
                    </p>
                  )}
                  {errors.status && <p className="text-[11px] text-destructive">{errors.status}</p>}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button
            onClick={close}
            disabled={submitting}
            className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            aria-busy={submitting || undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-70"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {existing ? "Save Changes" : submitting ? "Adding…" : "Add User"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------- detail page ------------------------------- */

type Tab = "overview" | "access" | "work" | "activity";

function UserDetail({
  user, onBack, onEdit, onDeactivate,
}: {
  user: OrgUser;
  onBack: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
}) {
  const {
    organizations, departments, teams, users, userActivity, canManageUsers,
    setUserStatus, removeMembership, upsertMembership, logUserActivity, resendWelcome, currentUser,
    soleAdminOrgIds,
  } = useOrganizations();
  const { tasks } = useWorkspace();
  const [tab, setTab] = useState<Tab>("overview");
  const [resending, setResending] = useState(false);

  // A new link for someone who never signed in — the first one expired, or the
  // email went astray. The server refuses anyone who already has (they use
  // Forgot password) and says so; that message is what the toast shows.
  const resend = async () => {
    if (resending) return;
    setResending(true);
    const result = await resendWelcome(user.id);
    setResending(false);
    if (result.ok) toast.success(`A new welcome email is on its way to ${user.email}`);
    else toast.error(result.error.message);
  };
  const [assignmentOrg, setAssignmentOrg] = useState<string | "new" | null>(null);
  const [removeOrg, setRemoveOrg] = useState<string | null>(null);

  const orgName = (id: string) => organizations.find((o) => o.id === id)?.name ?? "—";
  const deptName = (id?: string) => departments.find((d) => d.id === id)?.name ?? "—";
  const teamName = (id?: string) => teams.find((t) => t.id === id)?.name ?? "—";
  const userName = (id?: string) => users.find((u) => u.id === id)?.name ?? "—";

  const primaryMembership =
    user.memberships.find((m) => m.orgId === user.primaryOrgId) ?? user.memberships[0];

  // By id, not display name: two people can share a name.
  const myTasks = tasks.filter((t) => t.assigneeId === user.id);
  const openTasks = myTasks.filter((t) => t.status !== "done");
  const today = todayIn(organizations.find((o) => o.id === user.primaryOrgId)?.timezone);
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < today);
  const projectNames = Array.from(new Set(openTasks.map((t) => t.project)));
  const activity = userActivity.filter((a) => a.userId === user.id);

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "access", label: "Organization Access" },
    { id: "work", label: "Work" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to users
      </button>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
        <div className="flex items-center gap-4">
          <UserAvatar user={user} size={48} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{user.name}</h2>
              <StatusPill status={user.status} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {user.email}</span>
              {user.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {user.phone}</span>}
              <span className="inline-flex items-center gap-1"><Shield className="h-3 w-3" /> {primaryMembership?.role ?? "—"}</span>
            </div>
          </div>
        </div>
        {canManageUsers && (
          <div className="flex flex-wrap items-center gap-2">
            {user.id !== currentUser?.id && (
              <button
                onClick={() => void resend()}
                disabled={resending}
                aria-busy={resending || undefined}
                title="Send a new link to choose a password. For people who have not signed in yet."
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent disabled:opacity-60"
              >
                {resending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {resending ? "Sending…" : "Resend welcome email"}
              </button>
            )}
            <button onClick={onEdit} className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent">
              Edit User
            </button>
            {user.id === currentUser?.id ? null : user.status === "active" ? (
              <button onClick={onDeactivate} className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent">
                Deactivate
              </button>
            ) : (
              <button
                onClick={() => {
                  void setUserStatus(user.id, "active").then((saved) => {
                    if (saved) toast.success(`${user.name} activated`);
                  });
                }}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Activate
              </button>
            )}
          </div>
        )}
      </div>

      <div className="inline-flex items-center rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-soft)]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition",
              tab === t.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Name" value={user.name} />
            <Detail label="Email" value={user.email} />
            <Detail label="Phone" value={user.phone} />
            <Detail label="Employee ID" value={user.employeeId} />
            <Detail label="Designation" value={user.designation} />
            <Detail label="Joining Date" value={user.joiningDate} />
            <Detail label="Primary Organization" value={user.primaryOrgId ? orgName(user.primaryOrgId) : undefined} />
            <Detail label="Department" value={deptName(primaryMembership?.departmentId)} />
            <Detail label="Team" value={teamName(primaryMembership?.teamId)} />
            <Detail label="Reporting Manager" value={userName(primaryMembership?.reportingManagerId)} />
            <Detail label="Role" value={primaryMembership?.role} />
            <Detail label="Status" value={user.status === "active" ? "Active" : "Inactive"} />
          </div>
        </div>
      )}

      {tab === "access" && (
        <div className="space-y-3">
          {canManageUsers && (
            <div className="flex justify-end">
              <button
                onClick={() => setAssignmentOrg("new")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" /> Add Organization
              </button>
            </div>
          )}
          {user.memberships.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Not assigned to an organization you can see.
            </div>
          )}
          {user.memberships.map((m) => (
            <div
              key={m.orgId}
              className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  <span className="font-medium">{orgName(m.orgId)}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {m.orgId === user.primaryOrgId ? "Primary Organization" : "Additional Access"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Department: {deptName(m.departmentId)} · Team: {teamName(m.teamId)} · Role: {m.role}
                </div>
                <div className="text-xs text-muted-foreground">
                  Reporting Manager: {userName(m.reportingManagerId)}
                </div>
              </div>
              {canManageUsers && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAssignmentOrg(m.orgId)}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] hover:bg-accent"
                  >
                    Edit Assignment
                  </button>
                  {m.orgId !== user.primaryOrgId && (
                    <button
                      onClick={() => setRemoveOrg(m.orgId)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] hover:bg-accent"
                    >
                      <Trash2 className="h-3 w-3" /> Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "work" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span>Open Tasks <span className="font-semibold text-foreground">{openTasks.length}</span></span>
            <span className="h-3 w-px bg-border" />
            <span>Overdue Tasks <span className="font-semibold text-foreground">{overdue.length}</span></span>
            <span className="h-3 w-px bg-border" />
            <span>Active Projects <span className="font-semibold text-foreground">{projectNames.length}</span></span>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
            <div className="border-b border-border px-4 py-3 text-xs font-semibold">Current Tasks</div>
            {openTasks.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No open tasks.</div>
            ) : (
              <ul className="divide-y divide-border/60">
                {openTasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span className="min-w-0 truncate font-medium">{t.title}</span>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{t.project}</span>
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        {new Date(t.dueDate).toLocaleDateString()}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
            <div className="border-b border-border px-4 py-3 text-xs font-semibold">Current Projects</div>
            {projectNames.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No active projects.</div>
            ) : (
              <ul className="divide-y divide-border/60">
                {projectNames.map((p) => (
                  <li key={p} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span>{p}</span>
                    <span className="text-xs text-muted-foreground">
                      {plural(openTasks.filter((t) => t.project === p).length, "open task")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "activity" && (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
          {activity.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No administrative changes recorded in this session.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {activity.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="text-sm">{a.message}</div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {a.type.replace("-", " ")}
                    </div>
                  </div>
                  <div className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(a.at).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <AssignmentDialog
        user={user}
        orgId={assignmentOrg}
        onClose={() => setAssignmentOrg(null)}
        onSave={(membership, isNew) => {
          void upsertMembership(user.id, membership).then((saved) => {
            if (!saved) return;
            logUserActivity(
              user.id,
              isNew ? "organization-added" : "department-changed",
              isNew
                ? `Added to ${orgName(membership.orgId)} as ${membership.role}`
                : `Assignment updated for ${orgName(membership.orgId)}`,
            );
            toast.success("Organization access saved");
          });
          setAssignmentOrg(null);
        }}
      />

      <AlertDialog open={!!removeOrg} onOpenChange={(open) => !open && setRemoveOrg(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove access to {orgName(removeOrg ?? "")}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the assignment only. Tasks, comments, projects, and activity created in
              this organization remain unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const orgId = removeOrg;
                setRemoveOrg(null);
                if (!orgId) return;
                // Without a membership there they no longer count as its admin.
                if (soleAdminOrgIds(user).includes(orgId)) {
                  toast.error(
                    `There must always be at least one active admin in ${orgName(orgId)}. Make someone else admin first.`,
                  );
                  return;
                }
                void removeMembership(user.id, orgId).then((saved) => {
                  if (!saved) return;
                  logUserActivity(user.id, "organization-removed", `Access removed from ${orgName(orgId)}`);
                  toast.success("Organization access removed");
                });
              }}
            >
              Remove Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AssignmentDialog({
  user, orgId, onClose, onSave,
}: {
  user: OrgUser;
  orgId: string | "new" | null;
  onClose: () => void;
  onSave: (membership: Membership, isNew: boolean) => void;
}) {
  const { organizations, departments, teams, users, soleAdminOrgIds, roleGrantsAdmin } =
    useOrganizations();
  const { roleNames, defaultRoleFor } = useRoleChoices();
  const fieldId = useId();
  const existing = orgId && orgId !== "new" ? user.memberships.find((m) => m.orgId === orgId) : null;
  const [seed, setSeed] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftMembership>(blankDraft(""));

  if (orgId && seed !== orgId) {
    setSeed(orgId);
    setDraft({
      orgId: existing?.orgId ?? "",
      departmentId: existing?.departmentId ?? "",
      teamId: existing?.teamId ?? "",
      role: existing?.role ?? "",
      reportingManagerId: existing?.reportingManagerId ?? "",
    });
  }

  const availableOrgs = existing
    ? organizations.filter((o) => o.id === existing.orgId)
    : organizations.filter((o) => !user.memberships.some((m) => m.orgId === o.id));

  return (
    <Dialog open={!!orgId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Assignment" : "Add Organization"}</DialogTitle>
          <DialogDescription>
            Department and team assignments can differ per organization.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-org`} className={labelClass}>Organization</label>
            <select
              id={`${fieldId}-org`}
              value={draft.orgId}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  orgId: e.target.value,
                  departmentId: "",
                  teamId: "",
                  role: defaultRoleFor(e.target.value),
                })
              }
              className={inputClass}
              disabled={!!existing}
            >
              <option value="">Select organization</option>
              {availableOrgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-dept`} className={labelClass}>Department</label>
            <select
              id={`${fieldId}-dept`}
              value={draft.departmentId}
              onChange={(e) => setDraft({ ...draft, departmentId: e.target.value, teamId: "" })}
              className={inputClass}
              disabled={!draft.orgId}
            >
              <option value="">Select department</option>
              {departments
                .filter((d) => d.orgId === draft.orgId && (d.status === "active" || d.id === draft.departmentId))
                .map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-team`} className={labelClass}>Team</label>
            <select
              id={`${fieldId}-team`}
              value={draft.teamId}
              onChange={(e) => setDraft({ ...draft, teamId: e.target.value })}
              className={inputClass}
              disabled={!draft.departmentId}
            >
              <option value="">No team</option>
              {teams.filter((t) => t.departmentId === draft.departmentId).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-manager`} className={labelClass}>Reporting Manager</label>
            <select
              id={`${fieldId}-manager`}
              value={draft.reportingManagerId}
              onChange={(e) => setDraft({ ...draft, reportingManagerId: e.target.value })}
              className={inputClass}
            >
              <option value="">No manager</option>
              {users
                .filter((u) => u.id !== user.id && u.memberships.some((m) => m.orgId === draft.orgId))
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-role`} className={labelClass}>Role</label>
            <select
              id={`${fieldId}-role`}
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value })}
              className={inputClass}
              disabled={!draft.orgId}
            >
              {!draft.orgId && <option value="">Select organization first</option>}
              {draft.orgId && roleNames(draft.orgId, draft.role || undefined).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={() => {
              if (!draft.orgId || !draft.departmentId) {
                toast.error("Organization and department are required");
                return;
              }
              const role = draft.role || defaultRoleFor(draft.orgId);
              const next: Membership = {
                orgId: draft.orgId,
                departmentId: draft.departmentId,
                teamId: draft.teamId || undefined,
                role,
                // An organization switched off apart from Deactivate stays off: an edit
                // must not quietly turn it back on (or make Activate restore it).
                status: existing?.status ?? "active",
                reportingManagerId: draft.reportingManagerId || undefined,
              };
              // By the admin permission they hold, not the role's name (the same
              // rule the database applies when it saves this).
              if (
                existing &&
                soleAdminOrgIds(user).includes(draft.orgId) &&
                !roleGrantsAdmin(draft.orgId, role)
              ) {
                const orgLabel =
                  organizations.find((o) => o.id === draft.orgId)?.name ?? "this organization";
                toast.error(
                  `There must always be at least one active admin in ${orgLabel}. Make someone else admin first.`,
                );
                return;
              }
              onSave(next, !existing);
            }}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ deactivate flow ----------------------------- */

function DeactivateDialog({ user, onClose }: { user: OrgUser | null; onClose: () => void }) {
  const { users, organizations, setUserStatus, soleAdminOrgIds } = useOrganizations();
  const { tasks, updateTask } = useWorkspace();
  const [reassignTo, setReassignTo] = useState("");

  // By id: matching on the display name missed people and caught namesakes.
  const openTasks = user ? tasks.filter((t) => t.assigneeId === user.id && t.status !== "done") : [];
  const managedProjects = Array.from(new Set(openTasks.map((t) => t.project)));
  // Counted by the admin permission, as the database does when it refuses this.
  const soleAdminOf = user ? soleAdminOrgIds(user) : [];
  const isLastAdmin = soleAdminOf.length > 0;
  const soleOrgName = organizations.find((o) => o.id === soleAdminOf[0])?.name ?? "an organization";

  return (
    <AlertDialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate {user?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {isLastAdmin
              ? `${user?.name} is the last active admin of ${soleOrgName}. Make someone else admin first.`
              : "They're signed out and lose access to every organization until they're activated again. Tasks, comments, projects, and activity history remain unchanged."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span>Open Tasks <span className="font-semibold text-foreground">{openTasks.length}</span></span>
            <span className="h-3 w-px bg-border" />
            <span>Projects With Open Tasks <span className="font-semibold text-foreground">{managedProjects.length}</span></span>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="deactivate-reassign" className={labelClass}>Reassign Open Tasks</label>
            <select
              id="deactivate-reassign"
              value={reassignTo}
              onChange={(e) => setReassignTo(e.target.value)}
              className={inputClass}
              disabled={openTasks.length === 0}
            >
              <option value="">Keep current assignments</option>
              {users
                .filter((u) => u.id !== user?.id && u.status === "active")
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
            </select>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isLastAdmin}
            onClick={() => {
              if (!user || isLastAdmin) return;
              const target = users.find((u) => u.id === reassignTo);
              const tasksToMove = openTasks;
              setReassignTo("");
              onClose();
              // Tasks move only once the account really is switched off: the
              // database can still refuse (the last active admin of an organization).
              void setUserStatus(user.id, "inactive").then((saved) => {
                if (!saved) return;
                toast.success(`${user.name} deactivated`);
                if (target && tasksToMove.length) {
                  // Was an `assignee` display object, which updateTask never saved.
                  tasksToMove.forEach((t) => void updateTask(t.id, { assigneeId: target.id }));
                  toast.success(
                    `${plural(tasksToMove.length, "task")} reassigned to ${target.name}`,
                  );
                }
              });
            }}
          >
            Deactivate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
