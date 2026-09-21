import { useMemo, useState } from "react";
import {
  Plus, MoreHorizontal, Eye, Pencil, Ban, CheckCircle2, ArrowLeft, Search, X,
  Users as UsersIcon, ArrowRightLeft, Crown,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useOrganizations, type Department, type Team, type OrgStatus, type OrgUser,
} from "@/lib/organizations-data";

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20";
const labelClass = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50";
const ghostBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium transition hover:bg-accent";

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

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function Avatar({ user }: { user: OrgUser }) {
  return user.avatarUrl ? (
    <img src={user.avatarUrl} alt={user.name} className="h-7 w-7 shrink-0 rounded-full object-cover" />
  ) : (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
      {initials(user.name)}
    </div>
  );
}

export function StructurePage() {
  const {
    organizations, accessibleOrganizations, departments, teams, users,
    activeOrgId, setDepartmentStatus, setTeamStatus,
  } = useOrganizations();

  const [orgFilter, setOrgFilter] = useState<string>(
    activeOrgId !== "all" ? activeOrgId : (accessibleOrganizations[0]?.id ?? "all"),
  );
  const [tab, setTab] = useState<"departments" | "teams">("departments");
  const [deptDrawer, setDeptDrawer] = useState<Department | "new" | null>(null);
  const [teamDrawer, setTeamDrawer] = useState<Team | "new" | null>(null);
  const [openDeptId, setOpenDeptId] = useState<string | null>(null);
  const [deactivate, setDeactivate] = useState<
    { kind: "department" | "team"; id: string; name: string } | null
  >(null);

  const orgName = (id: string) => organizations.find((o) => o.id === id)?.name ?? "—";

  const visibleDepartments = useMemo(
    () => departments.filter((d) => orgFilter === "all" || d.orgId === orgFilter),
    [departments, orgFilter],
  );
  const visibleTeams = useMemo(
    () => teams.filter((t) => orgFilter === "all" || t.orgId === orgFilter),
    [teams, orgFilter],
  );

  const deptTeams = (deptId: string) => teams.filter((t) => t.departmentId === deptId);
  const deptMemberCount = (deptId: string) => {
    const ids = new Set<string>();
    users.forEach((u) => {
      if (u.memberships.some((m) => m.departmentId === deptId)) ids.add(u.id);
    });
    deptTeams(deptId).forEach((t) => t.memberIds.forEach((id) => ids.add(id)));
    return ids.size;
  };

  const openDept = openDeptId ? (departments.find((d) => d.id === openDeptId) ?? null) : null;

  if (openDept) {
    return (
      <>
        <DepartmentDetail
          department={openDept}
          onBack={() => setOpenDeptId(null)}
          onEdit={() => setDeptDrawer(openDept)}
          onAddTeam={() => setTeamDrawer("new")}
        />
        <DepartmentDrawer target={deptDrawer} onClose={() => setDeptDrawer(null)} defaultOrgId={openDept.orgId} />
        <TeamDrawer
          target={teamDrawer}
          onClose={() => setTeamDrawer(null)}
          defaultOrgId={openDept.orgId}
          defaultDepartmentId={openDept.id}
        />
      </>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Teams &amp; Departments</h2>
          <p className="text-sm text-muted-foreground">
            Manage departments, teams and reporting structures across your organizations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "teams" && (
            <button onClick={() => setTeamDrawer("new")} className={ghostBtn}>
              <Plus className="h-4 w-4" /> Add Team
            </button>
          )}
          <button onClick={() => setDeptDrawer("new")} className={primaryBtn}>
            <Plus className="h-4 w-4" /> Add Department
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className={labelClass}>Organization</div>
          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className={cn(inputClass, "min-w-[240px]")}
          >
            {accessibleOrganizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
            <option value="all">All Organizations</option>
          </select>
        </div>

        <div className="inline-flex items-center rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-soft)]">
          {(["departments", "teams"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition",
                tab === t ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "departments" ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Organization</th>
                  <th className="px-4 py-3 font-medium">Department Head</th>
                  <th className="px-4 py-3 font-medium">Teams</th>
                  <th className="px-4 py-3 font-medium">Members</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleDepartments.map((d) => (
                  <tr key={d.id} className="border-b border-border/60 transition last:border-0 hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <button onClick={() => setOpenDeptId(d.id)} className="text-left font-medium hover:text-primary">
                        {d.name}
                      </button>
                      {d.code && <div className="text-[11px] text-muted-foreground">{d.code}</div>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{orgName(d.orgId)}</td>
                    <td className="px-4 py-3">{d.head || "—"}</td>
                    <td className="px-4 py-3">{deptTeams(d.id).length} Teams</td>
                    <td className="px-4 py-3">{deptMemberCount(d.id)} Members</td>
                    <td className="px-4 py-3"><StatusPill status={d.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <RowMenu
                        onView={() => setOpenDeptId(d.id)}
                        onEdit={() => setDeptDrawer(d)}
                        status={d.status}
                        onDeactivate={() => setDeactivate({ kind: "department", id: d.id, name: d.name })}
                        onActivate={() => setDepartmentStatus(d.id, "active")}
                      />
                    </td>
                  </tr>
                ))}
                {visibleDepartments.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No departments yet for this organization.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Team</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Team Lead</th>
                  <th className="px-4 py-3 font-medium">Members</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleTeams.map((t) => {
                  const dept = departments.find((d) => d.id === t.departmentId);
                  const lead = users.find((u) => u.id === t.lead);
                  return (
                    <tr key={t.id} className="border-b border-border/60 transition last:border-0 hover:bg-accent/50">
                      <td className="px-4 py-3 font-medium">{t.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{dept?.name ?? "—"}</td>
                      <td className="px-4 py-3">{lead?.name ?? "—"}</td>
                      <td className="px-4 py-3">{t.memberIds.length}</td>
                      <td className="px-4 py-3"><StatusPill status={t.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <RowMenu
                          onView={() => setTeamDrawer(t)}
                          onEdit={() => setTeamDrawer(t)}
                          status={t.status}
                          onDeactivate={() => setDeactivate({ kind: "team", id: t.id, name: t.name })}
                          onActivate={() => setTeamStatus(t.id, "active")}
                        />
                      </td>
                    </tr>
                  );
                })}
                {visibleTeams.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No teams yet for this organization.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DepartmentDrawer
        target={deptDrawer}
        onClose={() => setDeptDrawer(null)}
        defaultOrgId={orgFilter === "all" ? (accessibleOrganizations[0]?.id ?? "") : orgFilter}
      />
      <TeamDrawer
        target={teamDrawer}
        onClose={() => setTeamDrawer(null)}
        defaultOrgId={orgFilter === "all" ? (accessibleOrganizations[0]?.id ?? "") : orgFilter}
      />

      <AlertDialog open={!!deactivate} onOpenChange={(o) => !o && setDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivate?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This {deactivate?.kind} will no longer appear for new assignments. Existing projects,
              tasks and historical activity remain unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deactivate) return;
                if (deactivate.kind === "department") setDepartmentStatus(deactivate.id, "inactive");
                else setTeamStatus(deactivate.id, "inactive");
                toast.success(`${deactivate.name} deactivated`);
                setDeactivate(null);
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RowMenu({
  onView, onEdit, onDeactivate, onActivate, status,
}: {
  onView: () => void;
  onEdit: () => void;
  onDeactivate: () => void;
  onActivate: () => void;
  status: OrgStatus;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground">
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onView}>
          <Eye className="mr-2 h-3.5 w-3.5" /> View
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onEdit}>
          <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
        </DropdownMenuItem>
        {status === "active" ? (
          <DropdownMenuItem onClick={onDeactivate}>
            <Ban className="mr-2 h-3.5 w-3.5" /> Deactivate
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={onActivate}>
            <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Activate
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DepartmentDrawer({
  target, onClose, defaultOrgId,
}: {
  target: Department | "new" | null;
  onClose: () => void;
  defaultOrgId: string;
}) {
  const { accessibleOrganizations, users, createDepartment, updateDepartment, isDepartmentNameTaken } =
    useOrganizations();
  const editing = target && target !== "new" ? target : null;
  const open = !!target;

  const [orgId, setOrgId] = useState(defaultOrgId);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [head, setHead] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<OrgStatus>("active");
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<string | null>(null);

  const key = editing?.id ?? (open ? "new" : null);
  if (key !== seed) {
    setSeed(key);
    setOrgId(editing?.orgId ?? defaultOrgId);
    setName(editing?.name ?? "");
    setCode(editing?.code ?? "");
    setHead(editing?.head ?? "");
    setDescription(editing?.description ?? "");
    setStatus(editing?.status ?? "active");
    setError(null);
  }

  const orgUsers = users.filter((u) => u.memberships.some((m) => m.orgId === orgId));

  const submit = () => {
    if (!orgId) return setError("Organization is required.");
    if (!name.trim()) return setError("Department name is required.");
    if (isDepartmentNameTaken(orgId, name, editing?.id))
      return setError("A department with this name already exists in this organization.");

    if (editing) {
      updateDepartment(editing.id, { orgId, name: name.trim(), code: code.trim(), head, description, status });
      toast.success("Department updated");
    } else {
      createDepartment({ orgId, name: name.trim(), code: code.trim(), head, description, status });
      toast.success("Department created");
    }
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit Department" : "Add Department"}</SheetTitle>
          <SheetDescription>Departments sit directly under an organization.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <label className={labelClass}>Organization *</label>
            <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className={inputClass}>
              {accessibleOrganizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Department Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Sales & Marketing" />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Department Code</label>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={inputClass} placeholder="SLS" maxLength={8} />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Department Head</label>
            <select value={head} onChange={(e) => setHead(e.target.value)} className={inputClass}>
              <option value="">Not assigned</option>
              {orgUsers.map((u) => (
                <option key={u.id} value={u.name}>{u.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as OrgStatus)} className={inputClass}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className={ghostBtn}>Cancel</button>
            <button onClick={submit} className={primaryBtn}>
              {editing ? "Save Changes" : "Create Department"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TeamDrawer({
  target, onClose, defaultOrgId, defaultDepartmentId,
}: {
  target: Team | "new" | null;
  onClose: () => void;
  defaultOrgId: string;
  defaultDepartmentId?: string;
}) {
  const {
    accessibleOrganizations, departments, users, createTeam, updateTeam, isTeamNameTaken,
  } = useOrganizations();
  const editing = target && target !== "new" ? target : null;
  const open = !!target;

  const [orgId, setOrgId] = useState(defaultOrgId);
  const [departmentId, setDepartmentId] = useState(defaultDepartmentId ?? "");
  const [name, setName] = useState("");
  const [lead, setLead] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [status, setStatus] = useState<OrgStatus>("active");
  const [memberSearch, setMemberSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<string | null>(null);

  const key = editing?.id ?? (open ? "new" : null);
  if (key !== seed) {
    setSeed(key);
    setOrgId(editing?.orgId ?? defaultOrgId);
    setDepartmentId(editing?.departmentId ?? defaultDepartmentId ?? "");
    setName(editing?.name ?? "");
    setLead(editing?.lead ?? "");
    setMemberIds(editing?.memberIds ?? []);
    setStatus(editing?.status ?? "active");
    setMemberSearch("");
    setError(null);
  }

  const orgDepartments = departments.filter(
    (d) => d.orgId === orgId && (d.status === "active" || d.id === departmentId),
  );

  // Only employees with access to the selected organization, department members first.
  const candidates = useMemo(() => {
    const list = users.filter((u) => u.memberships.some((m) => m.orgId === orgId));
    const inDept = (u: OrgUser) => u.memberships.some((m) => m.departmentId === departmentId);
    return list
      .filter((u) => u.name.toLowerCase().includes(memberSearch.trim().toLowerCase()))
      .sort((a, b) => Number(inDept(b)) - Number(inDept(a)) || a.name.localeCompare(b.name));
  }, [users, orgId, departmentId, memberSearch]);

  const submit = () => {
    if (!orgId) return setError("Organization is required.");
    if (!departmentId) return setError("Department is required.");
    if (!name.trim()) return setError("Team name is required.");
    if (isTeamNameTaken(departmentId, name, editing?.id))
      return setError("A team with this name already exists in this department.");

    const payload = {
      orgId, departmentId, name: name.trim(),
      lead: lead || undefined,
      memberIds: lead && !memberIds.includes(lead) ? [...memberIds, lead] : memberIds,
      status,
    };
    if (editing) {
      updateTeam(editing.id, payload);
      toast.success("Team updated");
    } else {
      createTeam(payload);
      toast.success("Team created");
    }
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit Team" : "Add Team"}</SheetTitle>
          <SheetDescription>Teams belong to a department inside an organization.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <label className={labelClass}>Organization *</label>
            <select
              value={orgId}
              onChange={(e) => {
                setOrgId(e.target.value);
                setDepartmentId("");
                setMemberIds([]);
                setLead("");
              }}
              className={inputClass}
            >
              {accessibleOrganizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className={labelClass}>Department *</label>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={inputClass}>
              <option value="">Select department</option>
              {orgDepartments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className={labelClass}>Team Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Curriculum" />
          </div>

          <div className="space-y-1.5">
            <label className={labelClass}>Team Lead</label>
            <select value={lead} onChange={(e) => setLead(e.target.value)} className={inputClass}>
              <option value="">Not assigned</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className={labelClass}>Members</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search employees"
                className={cn(inputClass, "pl-8")}
              />
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
              {candidates.map((u) => {
                const checked = memberIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() =>
                      setMemberIds((c) => (checked ? c.filter((id) => id !== u.id) : [...c, u.id]))
                    }
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-accent",
                      checked && "bg-accent/60",
                    )}
                  >
                    <Avatar user={u} />
                    <span className="min-w-0 flex-1 truncate">
                      {u.name}
                      <span className="block text-[11px] text-muted-foreground">{u.designation}</span>
                    </span>
                    {checked && <CheckCircle2 className="h-4 w-4 text-primary" />}
                  </button>
                );
              })}
              {candidates.length === 0 && (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No employees with access to this organization.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={labelClass}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as OrgStatus)} className={inputClass}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className={ghostBtn}>Cancel</button>
            <button onClick={submit} className={primaryBtn}>
              {editing ? "Save Changes" : "Create Team"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DepartmentDetail({
  department, onBack, onEdit, onAddTeam,
}: {
  department: Department;
  onBack: () => void;
  onEdit: () => void;
  onAddTeam: () => void;
}) {
  const {
    organizations, teams, users, updateTeam, addTeamMember, removeTeamMember, moveTeamMember,
    setTeamStatus,
  } = useOrganizations();
  const [tab, setTab] = useState<"teams" | "members">("teams");
  const [addMemberTeam, setAddMemberTeam] = useState<Team | null>(null);
  const [moveMember, setMoveMember] = useState<{ team: Team; userId: string } | null>(null);
  const [search, setSearch] = useState("");

  const org = organizations.find((o) => o.id === department.orgId);
  const deptTeams = teams.filter((t) => t.departmentId === department.id);
  const memberIds = new Set<string>();
  users.forEach((u) => {
    if (u.memberships.some((m) => m.departmentId === department.id)) memberIds.add(u.id);
  });
  deptTeams.forEach((t) => t.memberIds.forEach((id) => memberIds.add(id)));
  const members = users.filter((u) => memberIds.has(u.id));

  const userById = (id: string) => users.find((u) => u.id === id);
  const orgCandidates = users
    .filter((u) => u.memberships.some((m) => m.orgId === department.orgId))
    .filter((u) => u.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="space-y-6 animate-fade-in">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to departments
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{department.name}</h2>
            <StatusPill status={department.status} />
          </div>
          <p className="text-sm text-muted-foreground">{org?.name}</p>
          <div className="flex flex-wrap gap-5 pt-2 text-sm">
            <div>
              <div className={labelClass}>Department Head</div>
              <div>{department.head || "—"}</div>
            </div>
            <div>
              <div className={labelClass}>Members</div>
              <div>{members.length}</div>
            </div>
            <div>
              <div className={labelClass}>Teams</div>
              <div>{deptTeams.length}</div>
            </div>
          </div>
        </div>
        <button onClick={onEdit} className={ghostBtn}>
          <Pencil className="h-3.5 w-3.5" /> Edit Department
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-soft)]">
          {(["teams", "members"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition",
                tab === t ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "teams" && (
          <button onClick={onAddTeam} className={primaryBtn}>
            <Plus className="h-4 w-4" /> Add Team
          </button>
        )}
      </div>

      {tab === "teams" ? (
        <div className="space-y-4">
          {deptTeams.map((team) => (
            <div key={team.id} className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{team.name}</span>
                  <StatusPill status={team.status} />
                  <span className="text-xs text-muted-foreground">
                    Lead: {userById(team.lead ?? "")?.name ?? "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setAddMemberTeam(team)} className={ghostBtn}>
                    <Plus className="h-3.5 w-3.5" /> Add Member
                  </button>
                  <button
                    onClick={() => setTeamStatus(team.id, team.status === "active" ? "inactive" : "active")}
                    className={ghostBtn}
                  >
                    {team.status === "active" ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </div>

              <div className="mt-3 divide-y divide-border/60">
                {team.memberIds.map((id) => {
                  const u = userById(id);
                  if (!u) return null;
                  return (
                    <div key={id} className="flex items-center gap-3 py-2">
                      <Avatar user={u} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{u.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{u.designation}</div>
                      </div>
                      {team.lead === id && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          <Crown className="h-3 w-3" /> Lead
                        </span>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground">
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => updateTeam(team.id, { lead: id })}>
                            <Crown className="mr-2 h-3.5 w-3.5" /> Make Team Lead
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setMoveMember({ team, userId: id })}>
                            <ArrowRightLeft className="mr-2 h-3.5 w-3.5" /> Move Member
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              removeTeamMember(team.id, id);
                              toast.success(`${u.name} removed from ${team.name}`);
                            }}
                          >
                            <X className="mr-2 h-3.5 w-3.5" /> Remove Member
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
                {team.memberIds.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">No members yet.</p>
                )}
              </div>
            </div>
          ))}
          {deptTeams.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No teams in this department yet.
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Designation</th>
                <th className="px-4 py-3 font-medium">Teams</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {members.map((u) => (
                <tr key={u.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar user={u} />
                      <div>
                        <div className="font-medium">{u.name}</div>
                        <div className="text-[11px] text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.designation}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {deptTeams.filter((t) => t.memberIds.includes(u.id)).map((t) => t.name).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3"><StatusPill status={u.status} /></td>
                </tr>
              ))}
              {members.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No members in this department yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add member */}
      <Sheet open={!!addMemberTeam} onOpenChange={(o) => !o && setAddMemberTeam(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Add members to {addMemberTeam?.name}</SheetTitle>
            <SheetDescription>
              Only employees with access to {org?.name} are listed.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employees"
                className={cn(inputClass, "pl-8")}
              />
            </div>
            <div className="space-y-1">
              {orgCandidates.map((u) => {
                const already = addMemberTeam?.memberIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    disabled={already}
                    onClick={() => {
                      if (!addMemberTeam) return;
                      addTeamMember(addMemberTeam.id, u.id);
                      toast.success(`${u.name} added to ${addMemberTeam.name}`);
                      setAddMemberTeam(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition hover:bg-accent disabled:opacity-50"
                  >
                    <Avatar user={u} />
                    <span className="min-w-0 flex-1 truncate">
                      {u.name}
                      <span className="block text-[11px] text-muted-foreground">{u.designation}</span>
                    </span>
                    {already && <span className="text-[10px] text-muted-foreground">Already a member</span>}
                  </button>
                );
              })}
              {orgCandidates.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">No matching employees.</p>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Move member */}
      <Sheet open={!!moveMember} onOpenChange={(o) => !o && setMoveMember(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Move member</SheetTitle>
            <SheetDescription>
              Move {userById(moveMember?.userId ?? "")?.name} to another team in this organization.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-1">
            {teams
              .filter((t) => t.orgId === department.orgId && t.id !== moveMember?.team.id && t.status === "active")
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    if (!moveMember) return;
                    moveTeamMember(moveMember.team.id, t.id, moveMember.userId);
                    toast.success(`Moved to ${t.name}`);
                    setMoveMember(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition hover:bg-accent"
                >
                  <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1">{t.name}</span>
                </button>
              ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
