/**
 * Reads and writes for the email notification settings: one row per organization
 * (email_settings, admins only) and one row per person (notification_preferences).
 *
 * A missing row means "everything on, default schedule" — the worker reads it the
 * same way — so a load never fails just because nothing was saved yet. Saves are
 * upserts of the changed columns only; the columns left out keep their value.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { DEFAULT_EMAIL_SETTINGS, PREFERENCE_KINDS, type PreferenceKind } from "@/lib/email/kinds";
import type { AppRole } from "@/lib/email/snapshot";

type SettingsRow = Database["public"]["Tables"]["email_settings"]["Row"];
type SettingsInsert = Database["public"]["Tables"]["email_settings"]["Insert"];
type PreferencesRow = Database["public"]["Tables"]["notification_preferences"]["Row"];
type PreferencesInsert = Database["public"]["Tables"]["notification_preferences"]["Insert"];

export type KindSwitches = Record<PreferenceKind, boolean>;

export type EmailSettings = KindSwitches & {
  enabled: boolean;
  sendHour: number;
  /** ISO weekdays, 1 = Monday. */
  workingDays: number[];
  weeklyDay: number;
};

export type EmailSettingsPatch = Partial<EmailSettings>;
export type NotificationPreferences = KindSwitches;
export type NotificationPreferencesPatch = Partial<NotificationPreferences>;
export type MyRole = { organizationId: string; role: AppRole };

const allKindsOn = (): KindSwitches =>
  Object.fromEntries(PREFERENCE_KINDS.map((kind) => [kind, true])) as KindSwitches;

export const DEFAULT_ORG_EMAIL_SETTINGS: EmailSettings = {
  ...allKindsOn(),
  enabled: DEFAULT_EMAIL_SETTINGS.enabled,
  sendHour: DEFAULT_EMAIL_SETTINGS.send_hour,
  workingDays: [...DEFAULT_EMAIL_SETTINGS.working_days],
  weeklyDay: DEFAULT_EMAIL_SETTINGS.weekly_day,
};

export const DEFAULT_PREFERENCES: NotificationPreferences = allKindsOn();

function kindsFrom(row: Pick<SettingsRow | PreferencesRow, PreferenceKind>): KindSwitches {
  return Object.fromEntries(PREFERENCE_KINDS.map((kind) => [kind, row[kind]])) as KindSwitches;
}

function kindsPatch(patch: Partial<KindSwitches>): Partial<KindSwitches> {
  return Object.fromEntries(
    PREFERENCE_KINDS.filter((kind) => patch[kind] !== undefined).map((kind) => [kind, patch[kind]]),
  );
}

function settingsFromRow(row: SettingsRow): EmailSettings {
  return {
    ...kindsFrom(row),
    enabled: row.enabled,
    sendHour: row.send_hour,
    workingDays: [...row.working_days].sort((a, b) => a - b),
    weeklyDay: row.weekly_day,
  };
}

function settingsToRow(orgId: string, patch: EmailSettingsPatch): SettingsInsert {
  return {
    organization_id: orgId,
    ...kindsPatch(patch),
    ...(patch.enabled !== undefined && { enabled: patch.enabled }),
    ...(patch.sendHour !== undefined && { send_hour: patch.sendHour }),
    ...(patch.workingDays !== undefined && {
      working_days: [...new Set(patch.workingDays)].sort((a, b) => a - b),
    }),
    ...(patch.weeklyDay !== undefined && { weekly_day: patch.weeklyDay }),
  };
}

function logFailure(operation: string, error: unknown): null {
  console.error(`[flowdesk] ${operation} failed`, error);
  return null;
}

/** The organization's email settings, or the defaults when none were saved. null on failure. */
export async function loadEmailSettings(orgId: string): Promise<EmailSettings | null> {
  const { data, error } = await supabase
    .from("email_settings")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) return logFailure("load email settings", error);
  return data ? settingsFromRow(data) : { ...DEFAULT_ORG_EMAIL_SETTINGS };
}

/** Saves the changed fields and returns what the database now holds. null on failure. */
export async function saveEmailSettings(
  orgId: string,
  patch: EmailSettingsPatch,
): Promise<EmailSettings | null> {
  const { data, error } = await supabase
    .from("email_settings")
    .upsert(settingsToRow(orgId, patch), { onConflict: "organization_id" })
    .select("*")
    .single();
  if (error || !data) return logFailure("save email settings", error);
  return settingsFromRow(data);
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** The signed-in person's email preferences (all on when never saved). null on failure. */
export async function loadMyPreferences(): Promise<NotificationPreferences | null> {
  const userId = await currentUserId();
  if (!userId) return logFailure("load notification preferences", "no session");
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return logFailure("load notification preferences", error);
  return data ? kindsFrom(data) : { ...DEFAULT_PREFERENCES };
}

/** Saves the changed switches for the signed-in person. null on failure. */
export async function saveMyPreferences(
  patch: NotificationPreferencesPatch,
): Promise<NotificationPreferences | null> {
  const userId = await currentUserId();
  if (!userId) return logFailure("save notification preferences", "no session");
  const row: PreferencesInsert = { user_id: userId, ...kindsPatch(patch) };
  const { data, error } = await supabase
    .from("notification_preferences")
    .upsert(row, { onConflict: "user_id" })
    .select("*")
    .single();
  if (error || !data) return logFailure("save notification preferences", error);
  return kindsFrom(data);
}

/** The signed-in person's roles, one per organization. null on failure. */
export async function loadMyRoles(): Promise<MyRole[] | null> {
  const userId = await currentUserId();
  if (!userId) return logFailure("load roles", "no session");
  const { data, error } = await supabase
    .from("user_roles")
    .select("organization_id, role")
    .eq("user_id", userId);
  if (error) return logFailure("load roles", error);
  return (data ?? []).map((row) => ({ organizationId: row.organization_id, role: row.role }));
}
