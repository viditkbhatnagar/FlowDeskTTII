import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Globe2, Loader2, Lock, Mail, MailX } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useOrganizations } from "@/lib/organizations-data";
import { EMAIL_KIND_LABELS, ISO_WEEKDAYS, type PreferenceKind } from "@/lib/email/kinds";
import {
  loadEmailSettings,
  loadMyRoles,
  saveEmailSettings,
  type EmailSettings,
  type EmailSettingsPatch,
} from "@/lib/notifications-api";

const labelClass = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const inputClass =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20";
const cardClass = "rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]";

const KIND_GROUPS: { title: string; hint: string; kinds: PreferenceKind[] }[] = [
  {
    title: "As it happens",
    hint: "Sent within a few minutes, at any time of day.",
    kinds: ["task_assigned", "project_invitation"],
  },
  {
    title: "Reminders",
    hint: "Sent at the send time, on working days.",
    kinds: ["due_reminder", "overdue_alert"],
  },
  {
    title: "Digests",
    hint: "One summary per person instead of an email per task.",
    kinds: ["daily_digest", "weekly_digest"],
  },
  {
    title: "Management summaries",
    hint: "Only admins, managers and team leads receive these.",
    kinds: ["daily_management", "weekly_management"],
  },
];

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function hourLabel(hour: number): string {
  return `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`;
}

const sameDays = (a: number[], b: number[]) =>
  a.length === b.length && a.every((day, index) => day === b[index]);

/** The fields of `draft` that differ from `saved`, so a save writes only what changed. */
function changedFields(saved: EmailSettings, draft: EmailSettings): EmailSettingsPatch {
  return Object.fromEntries(
    (Object.keys(draft) as (keyof EmailSettings)[])
      .filter((key) =>
        key === "workingDays"
          ? !sameDays(saved.workingDays, draft.workingDays)
          : saved[key] !== draft[key],
      )
      .map((key) => [key, draft[key]]),
  ) as EmailSettingsPatch;
}

/**
 * Settings › Notifications: which emails Flowdesk sends for an organization, and
 * when. The settings route already limits this to admins; within it, only the
 * organizations the person administers are offered, because saving is refused
 * (row-level security) for any other.
 */
export function NotificationsSettingsPage() {
  const { status, accessibleOrganizations, activeOrgId } = useOrganizations();
  const [adminOrgIds, setAdminOrgIds] = useState<string[] | null>(null);
  const [rolesFailed, setRolesFailed] = useState(false);
  const [chosenOrg, setChosenOrg] = useState<string | null>(null);

  const loadRoles = useCallback(() => {
    setRolesFailed(false);
    void loadMyRoles().then((roles) => {
      if (!roles) return setRolesFailed(true);
      setAdminOrgIds(roles.filter((r) => r.role === "admin").map((r) => r.organizationId));
    });
  }, []);

  useEffect(loadRoles, [loadRoles]);

  const adminOrgs = useMemo(
    () => accessibleOrganizations.filter((org) => adminOrgIds?.includes(org.id)),
    [accessibleOrganizations, adminOrgIds],
  );
  const orgId =
    (chosenOrg && adminOrgs.some((o) => o.id === chosenOrg) ? chosenOrg : null) ??
    adminOrgs.find((o) => o.id === activeOrgId)?.id ??
    adminOrgs[0]?.id;
  const org = adminOrgs.find((o) => o.id === orgId);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Email Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Choose which emails Flowdesk sends to people in an organization, and when.
        </p>
      </div>

      {adminOrgs.length > 1 && (
        <div className="space-y-1">
          <label htmlFor="notifications-org" className={labelClass}>
            Organization
          </label>
          <select
            id="notifications-org"
            value={orgId}
            onChange={(e) => setChosenOrg(e.target.value)}
            className={cn(inputClass, "min-w-[240px] sm:w-auto")}
          >
            {adminOrgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {rolesFailed || status === "error" ? (
        <LoadProblem onRetry={loadRoles} />
      ) : adminOrgIds === null || status === "loading" ? (
        <Loading />
      ) : org ? (
        <SettingsEditor key={org.id} orgId={org.id} orgName={org.name} timezone={org.timezone} />
      ) : (
        <p className={cn(cardClass, "px-5 py-8 text-center text-sm text-muted-foreground")}>
          You are not an admin of an active organization, so there is nothing to configure here.
        </p>
      )}
    </div>
  );
}

function SettingsEditor({
  orgId,
  orgName,
  timezone,
}: {
  orgId: string;
  orgName: string;
  timezone: string;
}) {
  const [saved, setSaved] = useState<EmailSettings | null>(null);
  const [draft, setDraft] = useState<EmailSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    void loadEmailSettings(orgId).then((settings) => {
      if (!settings) return setFailed(true);
      setSaved(settings);
      setDraft(settings);
    });
  }, [orgId]);

  useEffect(load, [load]);

  if (failed) return <LoadProblem onRetry={load} />;
  if (!saved || !draft) return <Loading />;

  const patch = changedFields(saved, draft);
  const dirty = Object.keys(patch).length > 0;
  const update = (changes: EmailSettingsPatch) => setDraft({ ...draft, ...changes });

  const save = async () => {
    setSaving(true);
    const result = await saveEmailSettings(orgId, patch);
    setSaving(false);
    if (!result) {
      toast.error("Notification settings couldn't be saved. Please try again.");
      return;
    }
    setSaved(result);
    setDraft(result);
    toast.success("Notification settings saved.", { description: orgName });
  };

  return (
    <div className="space-y-5">
      <MasterSwitch enabled={draft.enabled} onChange={(enabled) => update({ enabled })} />

      <div className={cn("space-y-5 transition-opacity", !draft.enabled && "opacity-60")}>
        <KindsCard draft={draft} onChange={update} />
        <ScheduleCard draft={draft} timezone={timezone} onChange={update} />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">
          {dirty ? "You have unsaved changes." : "All changes saved."}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!dirty || saving}
          onClick={() => setDraft(saved)}
        >
          Discard
        </Button>
        <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}

function MasterSwitch({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <section
      className={cn(
        cardClass,
        "flex items-start justify-between gap-4 p-5",
        !enabled && "border-dashed",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
          aria-hidden="true"
        >
          {enabled ? <Mail className="h-4 w-4" /> : <MailX className="h-4 w-4" />}
        </span>
        <div>
          <label htmlFor="notifications-enabled" className="text-sm font-medium">
            Send email notifications
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {enabled
              ? "Flowdesk emails people in this organization using the choices below."
              : "Off: no notification emails are sent for this organization. Account access emails still go out."}
          </p>
        </div>
      </div>
      <Switch id="notifications-enabled" checked={enabled} onCheckedChange={onChange} />
    </section>
  );
}

function KindsCard({
  draft,
  onChange,
}: {
  draft: EmailSettings;
  onChange: (changes: EmailSettingsPatch) => void;
}) {
  return (
    <section className={cardClass} aria-labelledby="notifications-kinds">
      <header className="border-b border-border px-5 py-4">
        <h3 id="notifications-kinds" className="text-sm font-semibold">
          Emails
        </h3>
        <p className="text-xs text-muted-foreground">
          Turn an email off to stop it for everyone here. People can also opt out of each one
          themselves, from Profile &amp; password.
        </p>
      </header>
      <div className="divide-y divide-border">
        <AlwaysOnRow />
        {KIND_GROUPS.map((group) => (
          <div key={group.title} className="px-5 py-4">
            <p className={labelClass}>{group.title}</p>
            <p className="text-[11px] text-muted-foreground">{group.hint}</p>
            <div className="mt-3 space-y-3">
              {group.kinds.map((kind) => (
                <SwitchRow
                  key={kind}
                  id={`notifications-kind-${kind}`}
                  label={EMAIL_KIND_LABELS[kind].label}
                  description={EMAIL_KIND_LABELS[kind].description}
                  checked={draft[kind]}
                  onChange={(value) => onChange({ [kind]: value })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AlwaysOnRow() {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <div>
        <p className="text-sm font-medium">Account access</p>
        <p className="text-xs text-muted-foreground">
          When someone is given a Flowdesk account: how to set their password and sign in.
        </p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        <Lock className="h-3 w-3" aria-hidden="true" /> Always sent
      </span>
    </div>
  );
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p id={`${id}-description`} className="text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-describedby={`${id}-description`}
        className="mt-0.5"
      />
    </div>
  );
}

function ScheduleCard({
  draft,
  timezone,
  onChange,
}: {
  draft: EmailSettings;
  timezone: string;
  onChange: (changes: EmailSettingsPatch) => void;
}) {
  return (
    <section className={cardClass} aria-labelledby="notifications-schedule">
      <header className="border-b border-border px-5 py-4">
        <h3 id="notifications-schedule" className="text-sm font-semibold">
          Schedule
        </h3>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
          Times are in {timezone}, the organization&rsquo;s time zone.
        </p>
      </header>
      <div className="grid gap-5 px-5 py-5 md:grid-cols-2">
        <Field label="Send time" htmlFor="notifications-send-hour">
          <Select
            value={String(draft.sendHour)}
            onValueChange={(value) => onChange({ sendHour: Number(value) })}
          >
            <SelectTrigger id="notifications-send-hour" className="h-9 bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {HOURS.map((hour) => (
                <SelectItem key={hour} value={String(hour)}>
                  {hourLabel(hour)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Hint>Reminders, digests and summaries go out from this time.</Hint>
        </Field>

        <Field label="Weekly emails on" htmlFor="notifications-weekly-day">
          <Select
            value={String(draft.weeklyDay)}
            onValueChange={(value) => onChange({ weeklyDay: Number(value) })}
          >
            <SelectTrigger id="notifications-weekly-day" className="h-9 bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ISO_WEEKDAYS.map((day) => (
                <SelectItem key={day.value} value={String(day.value)}>
                  {day.long}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Hint>The weekly digest and weekly summary are sent on this day.</Hint>
        </Field>

        <div className="space-y-1.5 md:col-span-2">
          <p id="notifications-working-days" className={labelClass}>
            Working days
          </p>
          <ToggleGroup
            type="multiple"
            variant="outline"
            aria-labelledby="notifications-working-days"
            value={draft.workingDays.map(String)}
            // At least one working day: the database refuses an empty list.
            onValueChange={(values) => {
              if (values.length)
                onChange({ workingDays: values.map(Number).sort((a, b) => a - b) });
            }}
            className="flex-wrap justify-start"
          >
            {ISO_WEEKDAYS.map((day) => (
              <ToggleGroupItem
                key={day.value}
                value={String(day.value)}
                aria-label={day.long}
                className="min-w-12 bg-card text-xs data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
              >
                {day.short}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Hint>Daily emails are sent on working days only. Keep at least one day selected.</Hint>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className={labelClass}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-muted-foreground">{children}</p>;
}

function Loading() {
  return (
    <div
      className={cn(
        cardClass,
        "flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground",
      )}
      role="status"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Loading notification settings…
    </div>
  );
}

function LoadProblem({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 py-12 text-center"
      role="alert"
    >
      <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
      <p className="text-sm font-medium">Notification settings couldn&rsquo;t be loaded.</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
