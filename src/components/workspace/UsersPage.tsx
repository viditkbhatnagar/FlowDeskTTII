import { useMemo, useState } from "react";
import {
  Plus, MoreHorizontal, Eye, Pencil, Ban, ArrowLeft, Mail, Phone, Search,
  CheckCircle2, Trash2, Building2, Shield, CalendarDays, X,
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
import { Switch } from "@/components/ui/switch";
import {
  useOrganizations, roleOptions,
  type Membership, type OrgStatus, type OrgUser,
} from "@/lib/organizations-data";
import { useWorkspace } from "@/lib/workspace-data";

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
    users, organizations, departments, teams, countsFor, canManageUsers, setUserStatus,
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

  const orgName = (id: string) => organizations.find((o) => o.id === id)?.name ?? "—";
  const deptName = (id?: string) => departments.find((d) => d.id === id)?.name ?? "—";
  const teamName = (id?: string) => teams.find((t) => t.id === id)?.name ?? "—";

  const filterDepartments = useMemo(
    () => (orgFilter === "all" ? departments : departments.filter((d) => d.orgId === orgFilter)),
    [departments, orgFilter],
  );
  const filterTeams = useMemo(
    () => (deptFilter === "all" ? teams : teams.filter((t) => t.departmentId === deptFilter)),
    [teams, deptFilter],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
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
      if (scope.length === 0) return false;
      if (deptFilter !== "all" && !scope.some((m) => m.departmentId === deptFilter)) return false;
      if (teamFilter !== "all" && !scope.some((m) => m.teamId === teamFilter)) return false;
      if (roleFilter !== "all" && !scope.some((m) => m.role === roleFilter)) return false;
      return true;
    });
  }, [users, query, statusFilter, orgFilter, deptFilter, teamFilter, roleFilter]);

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

  const total = users.length;
  const active = users.filter((u) => u.status === "active").length;

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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users"
            className={cn(inputClass, "w-56 pl-8")}
          />
        </div>
        <select
          value={orgFilter}
          onChange={(e) => {
            setOrgFilter(e.target.value);
            setDeptFilter("all");
            setTeamFilter("all");
          }}
          className={cn(inputClass, "w-48")}
        >
          <option value="all">All Organizations</option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <select
          value={deptFilter}
          onChange={(e) => {
            setDeptFilter(e.target.value);
            setTeamFilter("all");
          }}
          className={cn(inputClass, "w-44")}
        >
          <option value="all">All Departments</option>
          {filterDepartments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className={cn(inputClass, "w-40")}
        >
          <option value="all">All Teams</option>
          {filterTeams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className={cn(inputClass, "w-36")}
        >
          <option value="all">All Roles</option>
          {roleOptions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
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
                const extra = user.memberships.length - 1;
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
                      {orgName(scoped?.orgId ?? user.primaryOrgId)}
                      {extra > 0 && orgFilter === "all" && (
                        <span className="ml-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          +{extra}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{deptName(scoped?.departmentId)}</td>
                    <td className="px-4 py-3">{teamName(scoped?.teamId)}</td>
                    <td className="px-4 py-3">{user.designation}</td>
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
                          {canManageUsers &&
                            (user.status === "active" ? (
                              <DropdownMenuItem onClick={() => setDeactivateUser(user)}>
                                <Ban className="mr-2 h-3.5 w-3.5" /> Deactivate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => {
                                  setUserStatus(user.id, "active");
                                  toast.success(`${user.name} activated`);
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
                    No users match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <UserDrawer target={drawerUser} onClose={() => setDrawerUser(null)} />
      <DeactivateDialog user={deactivateUser} onClose={() => setDeactivateUser(null)} />
      <div className="sr-only">{countsFor(organizations[0]?.id ?? "").users} users indexed</div>
    </div>
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

function UserDrawer({ target, onClose }: { target: OrgUser | "new" | null; onClose: () => void }) {
  const {
    organizations, departments, teams, users, addUser, updateUser, isEmailTaken,
    upsertMembership, logUserActivity,
  } = useOrganizations();
  const isNew = target === "new";
  const existing = target && target !== "new" ? target : null;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [designation, setDesignation] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [status, setStatus] = useState<OrgStatus>("active");
  const [sendLogin, setSendLogin] = useState(true);
  const [primary, setPrimary] = useState<DraftMembership>({
    orgId: "", departmentId: "", teamId: "", role: "Member", reportingManagerId: "",
  });
  const [additional, setAdditional] = useState<DraftMembership[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [seed, setSeed] = useState<string | null>(null);

  // Sync form to the target when the drawer opens for a different user.
  const key = existing?.id ?? (isNew ? "new" : "");
  if (target && seed !== key) {
    setSeed(key);
    setErrors({});
    if (existing) {
      const primaryMembership =
        existing.memberships.find((m) => m.orgId === existing.primaryOrgId) ?? existing.memberships[0];
      setName(existing.name);
      setEmail(existing.email);
      setPhone(existing.phone ?? "");
      setAvatarUrl(existing.avatarUrl ?? "");
      setEmployeeId(existing.employeeId ?? "");
      setDesignation(existing.designation);
      setJoiningDate(existing.joiningDate ?? "");
      setStatus(existing.status);
      setPrimary({
        orgId: existing.primaryOrgId,
        departmentId: primaryMembership?.departmentId ?? "",
        teamId: primaryMembership?.teamId ?? "",
        role: primaryMembership?.role ?? "Member",
        reportingManagerId: primaryMembership?.reportingManagerId ?? "",
      });
      setAdditional(
        existing.memberships
          .filter((m) => m.orgId !== existing.primaryOrgId)
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
      setDesignation(""); setJoiningDate(""); setStatus("active"); setSendLogin(true);
      setPrimary({ orgId: "", departmentId: "", teamId: "", role: "Member", reportingManagerId: "" });
      setAdditional([]);
    }
  }

  const submit = () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Full name is required";
    if (!email.trim()) next.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = "Enter a valid email";
    else if (isEmailTaken(email, existing?.id)) next.email = "This email already has an account";
    if (!designation.trim()) next.designation = "Designation is required";
    if (!primary.orgId) next.org = "Primary organization is required";
    if (!primary.departmentId) next.dept = "Department is required";
    if (!primary.role) next.role = "Role is required";
    if (additional.some((a) => !a.orgId || !a.departmentId))
      next.additional = "Each additional access needs an organization and department";
    if (new Set([primary.orgId, ...additional.map((a) => a.orgId)]).size !== additional.length + 1)
      next.additional = "An organization can only be assigned once";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const memberships: Membership[] = [
      {
        orgId: primary.orgId,
        departmentId: primary.departmentId || undefined,
        teamId: primary.teamId || undefined,
        role: primary.role,
        status: "active",
        reportingManagerId: primary.reportingManagerId || undefined,
      },
      ...additional.map<Membership>((a) => ({
        orgId: a.orgId,
        departmentId: a.departmentId || undefined,
        teamId: a.teamId || undefined,
        role: a.role,
        status: "active",
        reportingManagerId: a.reportingManagerId || undefined,
      })),
    ];

    if (existing) {
      updateUser(existing.id, {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        avatarUrl: avatarUrl.trim() || undefined,
        employeeId: employeeId.trim() || undefined,
        designation: designation.trim(),
        joiningDate: joiningDate || undefined,
        status,
        primaryOrgId: primary.orgId,
        memberships,
      });
      logUserActivity(existing.id, "updated", "User details updated");
      toast.success(`${name.trim()} updated`);
    } else {
      const created = addUser({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        avatarUrl: avatarUrl.trim() || undefined,
        employeeId: employeeId.trim() || undefined,
        designation: designation.trim(),
        joiningDate: joiningDate || undefined,
        status,
        primaryOrgId: primary.orgId,
        memberships,
      });
      memberships.slice(1).forEach((m) => upsertMembership(created.id, m));
      toast.success(
        sendLogin ? `${name.trim()} added — login details sent` : `${name.trim()} added`,
      );
    }
    onClose();
  };

  const managerOptions = (orgId: string) =>
    [...users].sort((a, b) => {
      const aIn = a.memberships.some((m) => m.orgId === orgId) ? 0 : 1;
      const bIn = b.memberships.some((m) => m.orgId === orgId) ? 0 : 1;
      return aIn - bIn || a.name.localeCompare(b.name);
    });

  const AssignmentFields = ({
    value, onChange, allowRole = true,
  }: {
    value: DraftMembership;
    onChange: (next: DraftMembership) => void;
    allowRole?: boolean;
  }) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <label className={labelClass}>Organization</label>
        <select
          value={value.orgId}
          onChange={(e) =>
            onChange({ ...value, orgId: e.target.value, departmentId: "", teamId: "", reportingManagerId: "" })
          }
          className={inputClass}
        >
          <option value="">Select organization</option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label className={labelClass}>Department</label>
        <select
          value={value.departmentId}
          onChange={(e) => onChange({ ...value, departmentId: e.target.value, teamId: "" })}
          className={inputClass}
          disabled={!value.orgId}
        >
          <option value="">Select department</option>
          {departments.filter((d) => d.orgId === value.orgId).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label className={labelClass}>Team</label>
        <select
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
        <label className={labelClass}>Reporting Manager</label>
        <select
          value={value.reportingManagerId}
          onChange={(e) => onChange({ ...value, reportingManagerId: e.target.value })}
          className={inputClass}
          disabled={!value.orgId}
        >
          <option value="">No manager</option>
          {managerOptions(value.orgId).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.memberships.some((m) => m.orgId === value.orgId) ? "" : " (other organization)"}
            </option>
          ))}
        </select>
      </div>
      {allowRole && (
        <div className="space-y-1.5">
          <label className={labelClass}>Role</label>
          <select
            value={value.role}
            onChange={(e) => onChange({ ...value, role: e.target.value })}
            className={inputClass}
          >
            {roleOptions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );

  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle>{existing ? "Edit User" : "Add User"}</SheetTitle>
          <SheetDescription>
            Employee identity, organization assignment, and system access.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section className="space-y-3">
            <div className={sectionClass}>Personal</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <label className={labelClass}>Full Name *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Neha Kapoor" />
                {errors.name && <p className="text-[11px] text-destructive">{errors.name}</p>}
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Email *</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="name@company.com" />
                {errors.email && <p className="text-[11px] text-destructive">{errors.email}</p>}
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className={labelClass}>Profile Photo URL</label>
                <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} className={inputClass} placeholder="https://" />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className={sectionClass}>Work</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className={labelClass}>Employee ID</label>
                <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Designation *</label>
                <input value={designation} onChange={(e) => setDesignation(e.target.value)} className={inputClass} />
                {errors.designation && <p className="text-[11px] text-destructive">{errors.designation}</p>}
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Joining Date</label>
                <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} className={inputClass} />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className={sectionClass}>Organization Assignment</div>
            <AssignmentFields value={primary} onChange={setPrimary} allowRole={false} />
            {(errors.org || errors.dept) && (
              <p className="text-[11px] text-destructive">{errors.org ?? errors.dept}</p>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className={sectionClass}>Additional Organization Access</div>
              <button
                onClick={() =>
                  setAdditional((c) => [
                    ...c,
                    { orgId: "", departmentId: "", teamId: "", role: "Member", reportingManagerId: "" },
                  ])
                }
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
                  onChange={(next) => setAdditional((c) => c.map((v, i) => (i === index ? next : v)))}
                />
              </div>
            ))}
            {errors.additional && <p className="text-[11px] text-destructive">{errors.additional}</p>}
          </section>

          <section className="space-y-3">
            <div className={sectionClass}>System Access</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className={labelClass}>Role *</label>
                <select
                  value={primary.role}
                  onChange={(e) => setPrimary({ ...primary, role: e.target.value })}
                  className={inputClass}
                >
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as OrgStatus)}
                  className={inputClass}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            {!existing && (
              <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
                <div>
                  <div className="text-sm">Send Login Details</div>
                  <div className="text-[11px] text-muted-foreground">
                    Email the employee an invitation to sign in.
                  </div>
                </div>
                <Switch checked={sendLogin} onCheckedChange={setSendLogin} />
              </div>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={submit}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            {existing ? "Save Changes" : "Add User"}
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
    setUserStatus, removeMembership, upsertMembership, logUserActivity,
  } = useOrganizations();
  const { tasks } = useWorkspace();
  const [tab, setTab] = useState<Tab>("overview");
  const [assignmentOrg, setAssignmentOrg] = useState<string | "new" | null>(null);
  const [removeOrg, setRemoveOrg] = useState<string | null>(null);

  const orgName = (id: string) => organizations.find((o) => o.id === id)?.name ?? "—";
  const deptName = (id?: string) => departments.find((d) => d.id === id)?.name ?? "—";
  const teamName = (id?: string) => teams.find((t) => t.id === id)?.name ?? "—";
  const userName = (id?: string) => users.find((u) => u.id === id)?.name ?? "—";

  const primaryMembership =
    user.memberships.find((m) => m.orgId === user.primaryOrgId) ?? user.memberships[0];

  const myTasks = tasks.filter((t) => t.assignee.name === user.name);
  const openTasks = myTasks.filter((t) => t.status !== "done");
  const overdue = openTasks.filter((t) => new Date(t.dueDate) < new Date());
  const projectNames = Array.from(new Set(myTasks.map((t) => t.project)));
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
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent">
              Edit User
            </button>
            {user.status === "active" ? (
              <button onClick={onDeactivate} className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-accent">
                Deactivate
              </button>
            ) : (
              <button
                onClick={() => {
                  setUserStatus(user.id, "active");
                  toast.success(`${user.name} activated`);
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
            <Detail label="Primary Organization" value={orgName(user.primaryOrgId)} />
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
                    <span className="font-medium">{t.title}</span>
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
                      {myTasks.filter((t) => t.project === p).length} tasks
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
              No administrative changes recorded.
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
          upsertMembership(user.id, membership);
          logUserActivity(
            user.id,
            isNew ? "organization-added" : "department-changed",
            isNew
              ? `Added to ${orgName(membership.orgId)} as ${membership.role}`
              : `Assignment updated for ${orgName(membership.orgId)}`,
          );
          toast.success("Organization access saved");
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
                if (removeOrg) {
                  removeMembership(user.id, removeOrg);
                  logUserActivity(
                    user.id,
                    "organization-removed",
                    `Access removed from ${orgName(removeOrg)}`,
                  );
                  toast.success("Organization access removed");
                }
                setRemoveOrg(null);
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
  const { organizations, departments, teams, users } = useOrganizations();
  const existing = orgId && orgId !== "new" ? user.memberships.find((m) => m.orgId === orgId) : null;
  const [seed, setSeed] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftMembership>({
    orgId: "", departmentId: "", teamId: "", role: "Member", reportingManagerId: "",
  });

  if (orgId && seed !== orgId) {
    setSeed(orgId);
    setDraft({
      orgId: existing?.orgId ?? "",
      departmentId: existing?.departmentId ?? "",
      teamId: existing?.teamId ?? "",
      role: existing?.role ?? "Member",
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
            <label className={labelClass}>Organization</label>
            <select
              value={draft.orgId}
              onChange={(e) => setDraft({ ...draft, orgId: e.target.value, departmentId: "", teamId: "" })}
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
            <label className={labelClass}>Department</label>
            <select
              value={draft.departmentId}
              onChange={(e) => setDraft({ ...draft, departmentId: e.target.value, teamId: "" })}
              className={inputClass}
              disabled={!draft.orgId}
            >
              <option value="">Select department</option>
              {departments.filter((d) => d.orgId === draft.orgId).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Team</label>
            <select
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
            <label className={labelClass}>Reporting Manager</label>
            <select
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
            <label className={labelClass}>Role</label>
            <select
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value })}
              className={inputClass}
            >
              {roleOptions.map((r) => (
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
              onSave(
                {
                  orgId: draft.orgId,
                  departmentId: draft.departmentId,
                  teamId: draft.teamId || undefined,
                  role: draft.role,
                  status: "active",
                  reportingManagerId: draft.reportingManagerId || undefined,
                },
                !existing,
              );
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
  const { users, setUserStatus, activeAdminCount } = useOrganizations();
  const { tasks, updateTask } = useWorkspace();
  const [reassignTo, setReassignTo] = useState("");

  const openTasks = user ? tasks.filter((t) => t.assignee.name === user.name && t.status !== "done") : [];
  const managedProjects = Array.from(new Set(openTasks.map((t) => t.project)));
  const isLastAdmin =
    !!user &&
    user.status === "active" &&
    user.memberships.some((m) => m.role.toLowerCase() === "admin") &&
    activeAdminCount <= 1;

  return (
    <AlertDialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate {user?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {isLastAdmin
              ? "This is the only active Admin. Give another employee the Admin role before deactivating this account."
              : "Login access will be disabled. Tasks, comments, projects, and activity history remain unchanged."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span>Open Tasks <span className="font-semibold text-foreground">{openTasks.length}</span></span>
            <span className="h-3 w-px bg-border" />
            <span>Managed Projects <span className="font-semibold text-foreground">{managedProjects.length}</span></span>
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Reassign Responsibilities</label>
            <select
              value={reassignTo}
              onChange={(e) => setReassignTo(e.target.value)}
              className={inputClass}
            >
              <option value="">Keep current assignments</option>
              {users
                .filter((u) => u.id !== user?.id && u.status === "active")
                .map((u) => (
                  <option key={u.id} value={u.name}>{u.name}</option>
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
              if (reassignTo) {
                const target = users.find((u) => u.name === reassignTo);
                openTasks.forEach((t) =>
                  updateTask(t.id, {
                    assignee: {
                      name: reassignTo,
                      initials: initialsOf(reassignTo),
                      color: t.assignee.color,
                    },
                  }),
                );
                if (target) toast.success(`${openTasks.length} tasks reassigned to ${reassignTo}`);
              }
              setUserStatus(user.id, "inactive");
              toast.success(`${user.name} deactivated`);
              setReassignTo("");
              onClose();
            }}
          >
            Deactivate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
