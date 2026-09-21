import { useMemo, useState } from "react";
import {
  Building2, Plus, MoreHorizontal, Eye, Pencil, Ban, ArrowLeft, Globe, Mail, Phone,
  MapPin, Clock, Search, CheckCircle2,
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
  useOrganizations, countryOptions, timezoneOptions,
  type Organization, type OrgStatus,
} from "@/lib/organizations-data";

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20";
const labelClass = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

function OrgLogo({ org, size = 32 }: { org: Organization; size?: number }) {
  if (org.logoUrl) {
    return (
      <img
        src={org.logoUrl}
        alt={`${org.name} logo`}
        className="shrink-0 rounded-lg object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[11px] font-semibold text-primary"
      style={{ width: size, height: size }}
    >
      {org.code.slice(0, 2).toUpperCase()}
    </div>
  );
}

function StatusPill({ status }: { status: OrgStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        status === "active"
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground",
      )}
    >
      {status === "active" ? "Active" : "Inactive"}
    </span>
  );
}

export function OrganizationsPage() {
  const { organizations, countsFor, setOrganizationStatus } = useOrganizations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOrg, setDrawerOrg] = useState<Organization | "new" | null>(null);
  const [deactivateOrg, setDeactivateOrg] = useState<Organization | null>(null);

  const selected = organizations.find((o) => o.id === selectedId) ?? null;

  if (selected) {
    return (
      <OrganizationDetail
        org={selected}
        onBack={() => setSelectedId(null)}
        onEdit={() => setDrawerOrg(selected)}
        drawer={
          <OrganizationDrawer
            target={drawerOrg}
            onClose={() => setDrawerOrg(null)}
          />
        }
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Organizations</h2>
          <p className="text-sm text-muted-foreground">
            Manage the organizations using this workspace.
          </p>
        </div>
        <button
          onClick={() => setDrawerOrg("new")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add Organization
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Organization</th>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Departments</th>
                <th className="px-4 py-3 font-medium">Users</th>
                <th className="px-4 py-3 font-medium">Active Projects</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((org) => {
                const counts = countsFor(org.id);
                return (
                  <tr
                    key={org.id}
                    className="border-b border-border/60 transition last:border-0 hover:bg-accent/50"
                  >
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelectedId(org.id)}
                        className="flex items-center gap-3 text-left"
                      >
                        <OrgLogo org={org} />
                        <span className="font-medium">{org.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{org.code}</td>
                    <td className="px-4 py-3">{counts.departments}</td>
                    <td className="px-4 py-3">{counts.users}</td>
                    <td className="px-4 py-3">{counts.activeProjects}</td>
                    <td className="px-4 py-3"><StatusPill status={org.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                            aria-label={`Actions for ${org.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => setSelectedId(org.id)}>
                            <Eye className="mr-2 h-3.5 w-3.5" /> View
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDrawerOrg(org)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                          </DropdownMenuItem>
                          {org.status === "active" ? (
                            <DropdownMenuItem onClick={() => setDeactivateOrg(org)}>
                              <Ban className="mr-2 h-3.5 w-3.5" /> Deactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => {
                                setOrganizationStatus(org.id, "active");
                                toast.success(`${org.name} reactivated`);
                              }}
                            >
                              <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Activate
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <OrganizationDrawer target={drawerOrg} onClose={() => setDrawerOrg(null)} />

      <AlertDialog open={!!deactivateOrg} onOpenChange={(open) => !open && setDeactivateOrg(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivateOrg?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Deactivating this organization will hide it from new project and task selections.
              Existing records and historical activity will remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deactivateOrg) {
                  setOrganizationStatus(deactivateOrg.id, "inactive");
                  toast.success(`${deactivateOrg.name} deactivated`);
                }
                setDeactivateOrg(null);
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

function OrganizationDrawer({
  target,
  onClose,
}: {
  target: Organization | "new" | null;
  onClose: () => void;
}) {
  const { addOrganization, updateOrganization, isNameTaken, isCodeTaken } = useOrganizations();
  const editing = target && target !== "new" ? target : null;

  const [form, setForm] = useState(() => blank());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  function blank() {
    return {
      name: "",
      code: "",
      logoUrl: "",
      email: "",
      phone: "",
      website: "",
      country: "",
      timezone: "",
      status: "active" as OrgStatus,
    };
  }

  const key = editing ? editing.id : target === "new" ? "new" : null;
  if (key && key !== loadedFor) {
    setLoadedFor(key);
    setErrors({});
    setForm(
      editing
        ? {
            name: editing.name,
            code: editing.code,
            logoUrl: editing.logoUrl ?? "",
            email: editing.email ?? "",
            phone: editing.phone ?? "",
            website: editing.website ?? "",
            country: editing.country,
            timezone: editing.timezone,
            status: editing.status,
          }
        : blank(),
    );
  }

  const set = (field: keyof ReturnType<typeof blank>, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const submit = () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next['name'] = "Organization name is required";
    else if (isNameTaken(form.name, editing?.id)) next['name'] = "An organization with this name already exists";
    if (!form.code.trim()) next['code'] = "Code is required";
    else if (form.code.trim().length > 8) next['code'] = "Keep the code short (max 8 characters)";
    else if (isCodeTaken(form.code, editing?.id)) next['code'] = "This code is already in use";
    if (!form.country) next['country'] = "Country is required";
    if (!form.timezone) next['timezone'] = "Timezone is required";
    setErrors(next);
    if (Object.keys(next).length) return;

    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      logoUrl: form.logoUrl.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      website: form.website.trim() || undefined,
      country: form.country,
      timezone: form.timezone,
      status: form.status,
    };

    if (editing) {
      updateOrganization(editing.id, payload);
      toast.success("Organization updated");
    } else {
      addOrganization(payload);
      toast.success("Organization added");
    }
    setLoadedFor(null);
    onClose();
  };

  return (
    <Sheet open={!!target} onOpenChange={(open) => { if (!open) { setLoadedFor(null); onClose(); } }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-base">
            {editing ? "Edit Organization" : "Add Organization"}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Organizations sit at the top of the hierarchy: Organization → Department → Team → Users.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <Field label="Organization Name" required error={errors['name']}>
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Teachers' Training Institute of India"
            />
          </Field>
          <Field label="Short Name / Code" required error={errors['code']}>
            <input
              className={cn(inputClass, "uppercase")}
              value={form.code}
              onChange={(e) => set("code", e.target.value)}
              placeholder="TTII"
            />
          </Field>
          <Field label="Logo URL">
            <input
              className={inputClass}
              value={form.logoUrl}
              onChange={(e) => set("logoUrl", e.target.value)}
              placeholder="https://…/logo.png"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Official Email">
              <input
                className={inputClass}
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="contact@ttii.in"
              />
            </Field>
            <Field label="Phone">
              <input
                className={inputClass}
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+91 22 4000 1200"
              />
            </Field>
          </div>
          <Field label="Website">
            <input
              className={inputClass}
              value={form.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="https://ttii.in"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Country" required error={errors['country']}>
              <select className={inputClass} value={form.country} onChange={(e) => set("country", e.target.value)}>
                <option value="">Select country</option>
                {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Timezone" required error={errors['timezone']}>
              <select className={inputClass} value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                <option value="">Select timezone</option>
                {timezoneOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Status">
            <select className={inputClass} value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button
            onClick={() => { setLoadedFor(null); onClose(); }}
            className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium transition hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
          >
            {editing ? "Save Changes" : "Add Organization"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label, required, error, children,
}: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className={labelClass}>
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function OrganizationDetail({
  org, onBack, onEdit, drawer,
}: { org: Organization; onBack: () => void; onEdit: () => void; drawer: React.ReactNode }) {
  const { countsFor, departments, teams, users, addDepartment, addUserToOrganization } = useOrganizations();
  const [tab, setTab] = useState<"overview" | "departments" | "users">("overview");
  const [deptOpen, setDeptOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const counts = countsFor(org.id);
  const orgDepartments = departments.filter((d) => d.orgId === org.id);
  const orgUsers = users.filter((u) => u.memberships.some((m) => m.orgId === org.id));

  return (
    <div className="space-y-6 animate-fade-in">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to organizations
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
        <div className="flex items-center gap-3">
          <OrgLogo org={org} size={44} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{org.name}</h2>
              <StatusPill status={org.status} />
            </div>
            <p className="text-xs text-muted-foreground">{org.code}</p>
          </div>
        </div>
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium transition hover:bg-accent"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit Organization
        </button>
      </div>

      <div className="inline-flex items-center rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-soft)]">
        {([["overview", "Overview"], ["departments", "Departments"], ["users", "Users"]] as const).map(
          ([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition",
                tab === id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ),
        )}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)]">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail icon={Building2} label="Organization Name" value={org.name} />
              <Detail icon={Building2} label="Organization Code" value={org.code} />
              <Detail icon={Mail} label="Email" value={org.email ?? "—"} />
              <Detail icon={Phone} label="Phone" value={org.phone ?? "—"} />
              <Detail icon={Globe} label="Website" value={org.website ?? "—"} />
              <Detail icon={MapPin} label="Country" value={org.country} />
              <Detail icon={Clock} label="Timezone" value={org.timezone} />
              <Detail
                icon={CheckCircle2}
                label="Status"
                value={org.status === "active" ? "Active" : "Inactive"}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Departments", counts.departments],
              ["Teams", counts.teams],
              ["Users", counts.users],
              ["Active Projects", counts.activeProjects],
            ].map(([label, value]) => (
              <div
                key={label as string}
                className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]"
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "departments" && (
        <TablePanel
          action={
            <button
              onClick={() => setDeptOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" /> Add Department
            </button>
          }
          title="Departments"
          head={["Department", "Department Head", "Teams", "Members", "Status"]}
        >
          {orgDepartments.map((d) => {
            const deptTeams = teams.filter((t) => t.departmentId === d.id);
            const members = orgUsers.filter((u) =>
              u.memberships.some((m) => m.orgId === org.id && m.departmentId === d.id),
            ).length;
            return (
              <tr key={d.id} className="border-b border-border/60 last:border-0 hover:bg-accent/50">
                <td className="px-4 py-3 font-medium">{d.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{d.head || "—"}</td>
                <td className="px-4 py-3">{deptTeams.length}</td>
                <td className="px-4 py-3">{members}</td>
                <td className="px-4 py-3"><StatusPill status={d.status} /></td>
              </tr>
            );
          })}
        </TablePanel>
      )}

      {tab === "users" && (
        <TablePanel
          action={
            <button
              onClick={() => setUserOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium transition hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" /> Add Existing User
            </button>
          }
          title="Users"
          head={["User", "Designation", "Department", "Team", "Role", "Status"]}
        >
          {orgUsers.map((u) => {
            const m = u.memberships.find((x) => x.orgId === org.id)!;
            const dept = departments.find((d) => d.id === m.departmentId);
            const team = teams.find((t) => t.id === m.teamId);
            return (
              <tr key={u.id} className="border-b border-border/60 last:border-0 hover:bg-accent/50">
                <td className="px-4 py-3">
                  <div className="font-medium">{u.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {u.email}
                    {u.primaryOrgId === org.id && " · Primary organization"}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{u.designation}</td>
                <td className="px-4 py-3">{dept?.name ?? "—"}</td>
                <td className="px-4 py-3">{team?.name ?? "—"}</td>
                <td className="px-4 py-3">{m.role}</td>
                <td className="px-4 py-3"><StatusPill status={m.status} /></td>
              </tr>
            );
          })}
        </TablePanel>
      )}

      <AddDepartmentDialog
        open={deptOpen}
        onClose={() => setDeptOpen(false)}
        onSave={(name, head) => {
          addDepartment(org.id, name, head);
          toast.success("Department added");
        }}
      />

      <AddExistingUserDialog
        open={userOpen}
        onClose={() => setUserOpen(false)}
        orgId={org.id}
        onSave={(userId, departmentId, teamId, role) => {
          addUserToOrganization(userId, org.id, { departmentId, teamId, role });
          toast.success("User added to organization");
        }}
      />

      {drawer}
    </div>
  );
}

function Detail({
  icon: Icon, label, value,
}: { icon: typeof Building2; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm">{value}</p>
      </div>
    </div>
  );
}

function TablePanel({
  title, head, action, children,
}: { title: string; head: string[]; action: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                {head.map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AddDepartmentDialog({
  open, onClose, onSave,
}: { open: boolean; onClose: () => void; onSave: (name: string, head: string) => void }) {
  const [name, setName] = useState("");
  const [head, setHead] = useState("");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Add Department</DialogTitle>
          <DialogDescription className="text-xs">
            Departments group teams and users inside this organization.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Department Name" required>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Learning & Growth" />
          </Field>
          <Field label="Department Head">
            <input className={inputClass} value={head} onChange={(e) => setHead(e.target.value)} placeholder="Priya Shah" />
          </Field>
        </div>
        <DialogFooter>
          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium transition hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (!name.trim()) return;
              onSave(name.trim(), head.trim());
              setName("");
              setHead("");
              onClose();
            }}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90"
          >
            Add Department
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddExistingUserDialog({
  open, onClose, orgId, onSave,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  onSave: (userId: string, departmentId: string, teamId: string, role: string) => void;
}) {
  const { users, departments, teams } = useOrganizations();
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [role, setRole] = useState("Member");

  const available = useMemo(
    () =>
      users.filter(
        (u) =>
          !u.memberships.some((m) => m.orgId === orgId) &&
          (u.name.toLowerCase().includes(query.toLowerCase()) ||
            u.email.toLowerCase().includes(query.toLowerCase())),
      ),
    [users, orgId, query],
  );

  const orgDepartments = departments.filter((d) => d.orgId === orgId);
  const deptTeams = teams.filter((t) => t.departmentId === departmentId);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Add Existing User</DialogTitle>
          <DialogDescription className="text-xs">
            Existing employees keep one account. Adding them here grants access to this
            organization with its own department and team assignment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Find Employee">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                className={cn(inputClass, "pl-8")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or email"
              />
            </div>
          </Field>

          <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
            {available.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No other employees available to add.
              </p>
            )}
            {available.map((u) => (
              <button
                key={u.id}
                onClick={() => setUserId(u.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs transition",
                  userId === u.id ? "bg-primary/10 text-primary" : "hover:bg-accent",
                )}
              >
                <span>
                  <span className="font-medium">{u.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{u.email}</span>
                </span>
                {userId === u.id && <CheckCircle2 className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department">
              <select
                className={inputClass}
                value={departmentId}
                onChange={(e) => { setDepartmentId(e.target.value); setTeamId(""); }}
              >
                <option value="">Select</option>
                {orgDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Team">
              <select className={inputClass} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">Select</option>
                {deptTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Role">
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="Admin">Admin</option>
              <option value="Manager">Manager</option>
              <option value="Member">Member</option>
              <option value="Viewer">Viewer</option>
            </select>
          </Field>
        </div>

        <DialogFooter>
          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium transition hover:bg-accent"
          >
            Cancel
          </button>
          <button
            disabled={!userId}
            onClick={() => {
              onSave(userId, departmentId, teamId, role);
              setUserId("");
              setDepartmentId("");
              setTeamId("");
              onClose();
            }}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
          >
            Add User
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
