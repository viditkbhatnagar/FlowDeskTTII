import { useMemo, useState } from "react";
import {
  Plus, MoreHorizontal, Eye, Pencil, Copy, Ban, CheckCircle2, ArrowLeft, ShieldCheck, Search, Lock,
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
  useOrganizations, permissionModules, settingsModules, scopeOptions, emptyRole, plural,
  type Role, type OrgStatus, type DataScope, type SettingsAccess, type NewRoleInput, type OrgUser,
} from "@/lib/organizations-data";

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20";
const labelClass = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50";
const ghostBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium transition hover:bg-accent disabled:opacity-50";

/** Shown wherever the permission checkboxes are, so nobody mistakes them for enforcement. */
const PERMISSIONS_NOTE =
  "These record what the role is for. What people can actually do is enforced by the role's access level: built-in roles have a fixed level, custom roles take it from Data Access.";

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

const scopeLabel = (scope: DataScope) => scopeOptions.find((s) => s.value === scope)?.label ?? scope;

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function RolesPage() {
  const {
    status, rolesFor, roleUserCount, setRoleStatus, duplicateRole, canManageUsers,
    accessibleOrganizations, activeOrgId, countsFor,
  } = useOrganizations();
  const [drawer, setDrawer] = useState<Role | "new" | null>(null);
  const [openRoleId, setOpenRoleId] = useState<string | null>(null);
  const [deactivateRole, setDeactivateRole] = useState<Role | null>(null);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);

  // Roles belong to one organization (each has its own Admin, Employee ...), so
  // the page shows one organization at a time. Listing every organization's rows
  // together showed "Admin" twice and counted people against both (FD-037).
  const orgId =
    selectedOrg ?? (activeOrgId !== "all" ? activeOrgId : (accessibleOrganizations[0]?.id ?? ""));
  const orgName = accessibleOrganizations.find((o) => o.id === orgId)?.name ?? "this organization";
  const roles = rolesFor(orgId);
  const openRole = openRoleId ? (roles.find((r) => r.id === openRoleId) ?? null) : null;
  const peopleInOrg = orgId ? countsFor(orgId).users : 0;

  if (openRole) {
    return (
      <>
        <RoleDetail role={openRole} onBack={() => setOpenRoleId(null)} onEdit={() => setDrawer(openRole)} />
        <RoleDrawer target={drawer} orgId={orgId} onClose={() => setDrawer(null)} />
      </>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Roles &amp; Permissions</h2>
          <p className="text-sm text-muted-foreground">Control what employees can access and manage.</p>
        </div>
        {canManageUsers && (
          <button onClick={() => setDrawer("new")} className={primaryBtn}>
            <Plus className="h-4 w-4" /> Add Role
          </button>
        )}
      </div>

      {accessibleOrganizations.length > 1 && (
        <div className="space-y-1">
          <label htmlFor="roles-org" className={labelClass}>Organization</label>
          <select
            id="roles-org"
            value={orgId}
            onChange={(e) => setSelectedOrg(e.target.value)}
            className={cn(inputClass, "min-w-[240px] sm:w-auto")}
          >
            {accessibleOrganizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Users</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id} className="border-b border-border/60 transition last:border-0 hover:bg-accent/50">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setOpenRoleId(role.id)}
                      className="flex items-center gap-2 text-left font-medium hover:text-primary"
                    >
                      <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                      {role.name}
                      {role.system && (
                        <Lock className="h-3 w-3 text-muted-foreground" aria-label="Built-in role" />
                      )}
                    </button>
                    <div className="pl-6 text-[11px] text-muted-foreground">
                      Data access: {scopeLabel(role.scope)}
                    </div>
                  </td>
                  <td className="px-4 py-3">{roleUserCount(role)}</td>
                  <td className="max-w-[360px] px-4 py-3 text-muted-foreground">{role.description || "—"}</td>
                  <td className="px-4 py-3"><StatusPill status={role.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`Actions for ${role.name}`}
                        className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setOpenRoleId(role.id)}>
                          <Eye className="mr-2 h-3.5 w-3.5" /> View
                        </DropdownMenuItem>
                        {canManageUsers && (
                          <>
                            <DropdownMenuItem onClick={() => setDrawer(role)}>
                              <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                duplicateRole(role.id);
                                toast.success(`${role.name} duplicated`);
                              }}
                            >
                              <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
                            </DropdownMenuItem>
                            {/* Built-in roles are never offered Deactivate: the database
                                refuses it, and deactivating Admin would lock everyone out (FD-062). */}
                            {role.system ? (
                              <DropdownMenuItem disabled>
                                <Lock className="mr-2 h-3.5 w-3.5" /> Built-in: can't be deactivated
                              </DropdownMenuItem>
                            ) : role.status === "active" ? (
                              <DropdownMenuItem onClick={() => setDeactivateRole(role)}>
                                <Ban className="mr-2 h-3.5 w-3.5" /> Deactivate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => {
                                  if (setRoleStatus(role.id, "active")) toast.success(`${role.name} activated`);
                                }}
                              >
                                <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Activate
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
              {roles.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {status === "loading"
                      ? "Loading roles…"
                      : status === "error"
                        ? "Roles could not be loaded. Refresh to try again."
                        : "No roles for this organization yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        {roles.length > 0 && (
          <p>
            {plural(peopleInOrg, "person", "people")} in {orgName}. Each holds exactly one role here, so the
            Users column adds up to that total.
          </p>
        )}
        <p>
          Built-in roles (marked with a lock) can't be renamed, deactivated or deleted; the database refuses it.
          There must always be at least one active Admin.
        </p>
      </div>

      <RoleDrawer target={drawer} orgId={orgId} onClose={() => setDrawer(null)} />

      <AlertDialog open={!!deactivateRole} onOpenChange={(o) => !o && setDeactivateRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivateRole?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This role will no longer be available when assigning access. People who already have it
              keep their history, but you should move them to another role.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deactivateRole) return;
                if (setRoleStatus(deactivateRole.id, "inactive")) {
                  toast.success(`${deactivateRole.name} deactivated`);
                }
                setDeactivateRole(null);
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

function PermissionEditor({
  value, onChange, readOnly,
}: {
  value: NewRoleInput;
  onChange: (updates: Partial<NewRoleInput>) => void;
  readOnly?: boolean;
}) {
  const toggle = (key: string) =>
    onChange({
      permissions: value.permissions.includes(key)
        ? value.permissions.filter((k) => k !== key)
        : [...value.permissions, key],
    });

  return (
    <div className="space-y-4">
      {permissionModules.map((module) => (
        <div key={module.key} className="rounded-lg border border-border p-3">
          <div className="mb-2 text-xs font-semibold">{module.label}</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {module.items.map((item) => {
              const checked = value.permissions.includes(item.key);
              return (
                <label
                  key={item.key}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition hover:bg-accent",
                    readOnly && "cursor-default hover:bg-transparent",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={readOnly}
                    onChange={() => toggle(item.key)}
                    className="h-3.5 w-3.5 rounded border-input accent-[hsl(var(--primary))]"
                  />
                  <span className={cn(!checked && "text-muted-foreground")}>{item.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 text-xs font-semibold">Settings</div>
        <div className="space-y-2">
          {settingsModules.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3">
              <span className="text-sm" id={`settings-access-${s.key}`}>{s.label}</span>
              <div
                role="group"
                aria-labelledby={`settings-access-${s.key}`}
                className="inline-flex items-center rounded-lg border border-border p-0.5"
              >
                {(["none", "view", "manage"] as SettingsAccess[]).map((level) => {
                  const active = (value.settings[s.key] ?? "none") === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      disabled={readOnly}
                      aria-pressed={active}
                      onClick={() => onChange({ settings: { ...value.settings, [s.key]: level } })}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {level === "none" ? "No Access" : level}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RoleDrawer({
  target, orgId, onClose,
}: { target: Role | "new" | null; orgId: string; onClose: () => void }) {
  const {
    createRole,
    updateRole,
    isRoleNameTaken,
    roleMembers,
    isAdminIn,
    activeAdminCountIn,
    accessibleOrganizations,
  } = useOrganizations();
  const editing = target && target !== "new" ? target : null;
  const open = !!target;

  const [draft, setDraft] = useState<NewRoleInput>(emptyRole);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<string | null>(null);

  const key = editing?.id ?? (open ? "new" : null);
  if (key !== seed) {
    setSeed(key);
    setDraft(editing ? { ...editing } : { ...emptyRole, settings: { ...emptyRole.settings } });
    setError(null);
  }

  const patch = (updates: Partial<NewRoleInput>) => setDraft((d) => ({ ...d, ...updates }));

  const submit = () => {
    if (!draft.name.trim()) return setError("Role name is required.");
    const roleOrg = editing?.orgId ?? orgId;
    if (isRoleNameTaken(draft.name, editing?.id, roleOrg)) return setError("A role with this name already exists.");

    if (editing) {
      // A custom role's Data Access is its permission: moving it off "All
      // Organizations" takes admin away from everyone holding it. Refused when
      // that would leave the organization without an active admin (the
      // database refuses it too, and says so).
      if (!editing.system && editing.baseRole === "admin" && draft.scope !== "all" && roleOrg) {
        const adminHolders = roleMembers(editing).filter(
          (u) => u.status === "active" && isAdminIn(u, roleOrg),
        );
        if (adminHolders.length && activeAdminCountIn(roleOrg) - adminHolders.length <= 0) {
          const orgLabel =
            accessibleOrganizations.find((o) => o.id === roleOrg)?.name ?? "this organization";
          return setError(
            `There must always be at least one active admin in ${orgLabel}. Make someone else admin first.`,
          );
        }
      }
      void updateRole(editing.id, { ...draft, name: draft.name.trim() }).then((saved) => {
        if (saved) toast.success("Role updated");
      });
    } else {
      createRole({ ...draft, name: draft.name.trim(), orgId: roleOrg || undefined });
      toast.success("Role created");
    }
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border p-6">
          <SheetTitle>{editing ? `Edit ${editing.name}` : "Add Role"}</SheetTitle>
          <SheetDescription>Choose what this role can see and manage.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="space-y-1.5">
            <label htmlFor="role-name" className={labelClass}>Role Name *</label>
            <input
              id="role-name"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              className={inputClass}
              placeholder="Coordinator"
              disabled={editing?.system}
            />
            {editing?.system && (
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Lock className="h-3 w-3" /> Built-in role names can't be changed.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="role-description" className={labelClass}>Description</label>
            <textarea
              id="role-description"
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="role-scope" className={labelClass}>Data Access</label>
            <select
              id="role-scope"
              value={draft.scope}
              onChange={(e) => patch({ scope: e.target.value as DataScope })}
              className={inputClass}
            >
              {scopeOptions.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              {scopeOptions.find((s) => s.value === draft.scope)?.hint}
            </p>
          </div>

          <div className="space-y-1.5">
            <div className={labelClass}>Permissions</div>
            <p className="text-[11px] text-muted-foreground">{PERMISSIONS_NOTE}</p>
            <PermissionEditor value={draft} onChange={patch} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="role-status" className={labelClass}>Status</label>
            <select
              id="role-status"
              value={draft.status}
              onChange={(e) => patch({ status: e.target.value as OrgStatus })}
              className={inputClass}
              // Was disabled for a role literally named "Admin" only; every
              // built-in role is refused by the database (FD-062).
              disabled={editing?.system}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            {editing?.system && (
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Lock className="h-3 w-3" /> Built-in roles are always active.
              </p>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button onClick={onClose} className={ghostBtn}>Cancel</button>
          <button onClick={submit} className={primaryBtn}>
            {editing ? "Save Changes" : "Create Role"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RoleDetail({ role, onBack, onEdit }: { role: Role; onBack: () => void; onEdit: () => void }) {
  const {
    users, rolesFor, roleMembers, assignRole, activeAdminCount, activeAdminCountIn, isAdminIn,
    canManageUsers, accessibleOrganizations,
  } = useOrganizations();
  const [assignOpen, setAssignOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<{ user: OrgUser; role: Role } | null>(null);

  const orgId = role.orgId ?? "";
  const orgName = accessibleOrganizations.find((o) => o.id === orgId)?.name;
  // Same rule as the Users page and the Users column (FD-063, FD-067).
  const members = roleMembers(role);
  const otherRoles = rolesFor(orgId).filter((r) => r.status === "active" && r.id !== role.id);

  const candidates = useMemo(
    () =>
      users
        // Only people in this role's organization can hold it.
        .filter((u) => !orgId || u.memberships.some((m) => m.orgId === orgId))
        .filter((u) => !members.some((m) => m.id === u.id))
        .filter((u) => u.name.toLowerCase().includes(search.trim().toLowerCase())),
    [users, members, search, orgId],
  );

  const requestAssign = (user: OrgUser, next: Role) => {
    const nextIsAdmin = next.baseRole ? next.baseRole === "admin" : next.name.trim().toLowerCase() === "admin";
    const userIsAdmin = orgId
      ? isAdminIn(user, orgId)
      : user.memberships.some((m) => isAdminIn(user, m.orgId));
    // Counted by the admin permission people hold, as the database does.
    const adminsHere = orgId ? activeAdminCountIn(orgId) : activeAdminCount;
    if (userIsAdmin && !nextIsAdmin && user.status === "active" && adminsHere <= 1) {
      toast.error(
        `There must always be at least one active admin in ${orgName ?? "this organization"}. Make someone else admin first.`,
      );
      return;
    }
    setConfirm({ user, role: next });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to roles
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold tracking-tight">{role.name}</h2>
            <StatusPill status={role.status} />
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">{role.description}</p>
          <div className="flex flex-wrap gap-5 pt-2 text-sm">
            {accessibleOrganizations.length > 1 && orgName && (
              <div>
                <div className={labelClass}>Organization</div>
                <div>{orgName}</div>
              </div>
            )}
            <div>
              <div className={labelClass}>Data Access</div>
              <div>{scopeLabel(role.scope)}</div>
            </div>
            <div>
              <div className={labelClass}>Users</div>
              <div>{members.length}</div>
            </div>
          </div>
        </div>
        {canManageUsers && (
          <div className="flex items-center gap-2">
            <button onClick={() => setAssignOpen(true)} className={ghostBtn}>
              <Plus className="h-3.5 w-3.5" /> Assign Users
            </button>
            <button onClick={onEdit} className={primaryBtn}>
              <Pencil className="h-3.5 w-3.5" /> Edit Role
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
          <h3 className="mb-1 text-sm font-semibold">Permissions</h3>
          <p className="mb-3 text-[11px] text-muted-foreground">{PERMISSIONS_NOTE}</p>
          <PermissionEditor value={role} onChange={() => {}} readOnly />
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">People with this role</div>
          <div className="divide-y divide-border/60">
            {members.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                  {initials(u.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{u.designation || u.email}</div>
                </div>
                {canManageUsers && otherRoles.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Change role for ${u.name}`}
                      className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {otherRoles.map((r) => (
                        <DropdownMenuItem key={r.id} onClick={() => requestAssign(u, r)}>
                          Change to {r.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
            {members.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Nobody has this role yet.
              </p>
            )}
          </div>
        </div>
      </div>

      <Sheet open={assignOpen} onOpenChange={setAssignOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Assign {role.name}</SheetTitle>
            <SheetDescription>
              Pick the employees who should get this role{orgName ? ` in ${orgName}` : ""}.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                aria-label="Search employees"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employees"
                className={cn(inputClass, "pl-8")}
              />
            </div>
            <div className="space-y-1">
              {candidates.map((u) => (
                <button
                  key={u.id}
                  onClick={() => {
                    requestAssign(u, role);
                    setAssignOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition hover:bg-accent"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                    {initials(u.name)}
                  </div>
                  <span className="min-w-0 flex-1 truncate">
                    {u.name}
                    <span className="block text-[11px] text-muted-foreground">{u.designation || u.email}</span>
                  </span>
                </button>
              ))}
              {candidates.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">No matching employees.</p>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change role for {confirm?.user.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.user.name} will get the {confirm?.role.name} role
              {orgName ? ` in ${orgName}` : ""}. Access updates the next time they refresh the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirm) return;
                const { user, role: next } = confirm;
                setConfirm(null);
                // A change the database refuses (the organization's last active
                // admin) shows its reason instead.
                void assignRole(user.id, next.id).then((saved) => {
                  if (saved) toast.success(`${user.name} is now ${next.name}`);
                });
              }}
            >
              Change Role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
