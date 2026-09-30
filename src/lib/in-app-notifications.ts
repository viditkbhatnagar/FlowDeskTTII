/**
 * In-app notifications: what the bell in the header lists, and the sentence each
 * one reads as (QA, 29 Sep 2026: "Notification box / pop up / or sound as the
 * project and task moves forward").
 *
 * Rows are written only by the database (triggers in
 * 20260930000200_in_app_notifications.sql), one per person per event. Names,
 * titles and status labels are copied into `payload` when the row is written, so
 * a notification still reads the same after the task is renamed. Row-level
 * security limits every read and write here to the signed-in person's own rows,
 * and read_at is the only column a person can change.
 *
 * The loaders return null on failure. The bell polls, so each kind of failure is
 * logged once until it recovers: an environment without the migration shows an
 * empty bell and one console line, not a broken header or a console full of them.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

export const NOTIFICATION_KINDS = [
  "task_assigned",
  "task_review_requested",
  "task_completed",
  "task_status_changed",
  "task_commented",
  "task_created_in_project",
  "project_member_added",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** The columns the bell uses. recipient_id and dedupe_key stay in the database. */
export type InAppNotification = Pick<
  NotificationRow,
  "id" | "kind" | "actor_id" | "task_id" | "project_id" | "payload" | "created_at" | "read_at"
>;

/** What a notification says, and where opening it goes. */
export type NotificationView = {
  title: string;
  /** The second line; empty when there is nothing more to say. */
  description: string;
  href: string;
};

const COLUMNS = "id, kind, actor_id, task_id, project_id, payload, created_at, read_at";

/** How many the bell lists. Older ones stay in the database until the nightly purge. */
export const NOTIFICATION_LIST_LIMIT = 30;
/** The most one catch-up after a lost connection reads. */
const CATCH_UP_LIMIT = 100;

/** Longest task or project name shown before it is cut with "…". */
const NAME_MAX = 60;
/** Longest person name or role label shown. */
const PERSON_MAX = 40;
/** Longest comment excerpt shown; the database already stores at most 140 characters. */
const EXCERPT_MAX = 140;

/** The built-in names, for a payload written without the organization's own label. */
const DEFAULT_STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  progress: "In Progress",
  review: "Waiting Approval",
  done: "Completed",
  cancelled: "Cancelled",
};

// ---------------------------------------------------------------------------
// Reading and marking read
// ---------------------------------------------------------------------------

const loggedFailures = new Set<string>();

function logFailureOnce(operation: string, error: unknown): void {
  if (loggedFailures.has(operation)) return;
  loggedFailures.add(operation);
  console.error(`[flowdesk] notifications: could not ${operation}`, error);
}

/** After a success, the next failure of the same kind is worth a line again. */
function recovered(operation: string): void {
  loggedFailures.delete(operation);
}

function rowsFrom(data: unknown[] | null): InAppNotification[] {
  return (data ?? []).flatMap((raw) => {
    const row = toNotification(raw);
    return row ? [row] : [];
  });
}

/** The latest notifications, newest first. */
export async function listNotifications(userId: string): Promise<InAppNotification[] | null> {
  const operation = "load notifications";
  // recipient_id is what RLS allows anyway; filtering on it as well lets the
  // (recipient_id, created_at) index serve the query.
  const { data, error } = await supabase
    .from("notifications")
    .select(COLUMNS)
    .eq("recipient_id", userId)
    .order("created_at", { ascending: false })
    .limit(NOTIFICATION_LIST_LIMIT);
  if (error) {
    logFailureOnce(operation, error);
    return null;
  }
  recovered(operation);
  return rowsFrom(data);
}

/** Everything written at or after `since`: what arrived while live updates were down. */
export async function listNotificationsSince(
  userId: string,
  since: string,
): Promise<InAppNotification[] | null> {
  const operation = "catch up on notifications";
  const { data, error } = await supabase
    .from("notifications")
    .select(COLUMNS)
    .eq("recipient_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(CATCH_UP_LIMIT);
  if (error) {
    logFailureOnce(operation, error);
    return null;
  }
  recovered(operation);
  return rowsFrom(data);
}

/** How many are unread in all, not only among the ones listed. */
export async function countUnreadNotifications(userId: string): Promise<number | null> {
  const operation = "count unread notifications";
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", userId)
    .is("read_at", null);
  if (error) {
    logFailureOnce(operation, error);
    return null;
  }
  recovered(operation);
  return count ?? 0;
}

/** Marks one read. One already read keeps the time it was first read. */
export async function markNotificationRead(id: string, readAt: string): Promise<boolean> {
  const operation = "mark a notification read";
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: readAt })
    .eq("id", id)
    .is("read_at", null);
  if (error) {
    logFailureOnce(operation, error);
    return false;
  }
  recovered(operation);
  return true;
}

/** Marks every unread one read, including those older than the list shows. */
export async function markAllNotificationsRead(userId: string, readAt: string): Promise<boolean> {
  const operation = "mark notifications read";
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: readAt })
    .eq("recipient_id", userId)
    .is("read_at", null);
  if (error) {
    logFailureOnce(operation, error);
    return false;
  }
  recovered(operation);
  return true;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in in-app-notifications.test.ts)
// ---------------------------------------------------------------------------

/**
 * Milliseconds since the epoch for a Postgres timestamp, or 0 when unreadable.
 * PostgREST sends ISO 8601 with microseconds; Realtime passes timestamptz through
 * as Postgres prints it ("2026-09-30 10:00:00.123456+00"), which some browsers
 * cannot parse as it stands.
 */
export function timestampMs(value: string): number {
  const iso = value
    .trim()
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1")
    // "+00" → "+00:00", only after a time, so a bare date's "-30" is left alone.
    .replace(/(:\d{2}(?:\.\d+)?[+-]\d{2})$/, "$1:00");
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = timestampMs(value);
  return ms ? new Date(ms).toISOString() : null;
}

function idOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * A row from PostgREST or a Realtime event, checked and with its times in ISO
 * form; null when it is not a usable notification.
 */
export function toNotification(raw: unknown): InAppNotification | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = idOrNull(record.id);
  const kind = typeof record.kind === "string" ? record.kind : null;
  const createdAt = isoOrNull(record.created_at);
  if (!id || !kind || !createdAt) return null;
  return {
    id,
    kind,
    actor_id: idOrNull(record.actor_id),
    task_id: idOrNull(record.task_id),
    project_id: idOrNull(record.project_id),
    payload: (record.payload ?? {}) as Json,
    created_at: createdAt,
    read_at: isoOrNull(record.read_at),
  };
}

function newestFirst(a: InAppNotification, b: InAppNotification): number {
  return timestampMs(b.created_at) - timestampMs(a.created_at) || b.id.localeCompare(a.id);
}

/**
 * Lays `incoming` over `current` by id, newest first, keeping `limit`. Read is
 * one-way here: a poll that set off before a click must not make the clicked
 * notification unread again when it lands.
 */
export function mergeNotifications(
  current: readonly InAppNotification[],
  incoming: readonly InAppNotification[],
  limit: number = NOTIFICATION_LIST_LIMIT,
): InAppNotification[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const next of incoming) {
    const previous = byId.get(next.id);
    byId.set(next.id, previous ? { ...next, read_at: next.read_at ?? previous.read_at } : next);
  }
  return [...byId.values()].sort(newestFirst).slice(0, limit);
}

/** The ones worth a pop-up: not seen before in this tab, and still unread. Oldest first. */
export function unseenUnread(
  known: ReadonlySet<string>,
  incoming: readonly InAppNotification[],
): InAppNotification[] {
  const seen = new Set(known);
  const fresh: InAppNotification[] = [];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (!item.read_at) fresh.push(item);
  }
  return fresh.sort((a, b) => newestFirst(b, a));
}

/** The latest created_at among the rows and `current`, to catch up from. */
export function newestCreatedAt(
  rows: readonly Pick<InAppNotification, "created_at">[],
  current?: string,
): string | undefined {
  return rows.reduce<string | undefined>(
    (newest, row) =>
      !newest || timestampMs(row.created_at) > timestampMs(newest) ? row.created_at : newest,
    current,
  );
}

/** The badge on the bell: nothing at zero, "9+" above nine. */
export function unreadBadge(count: number): string {
  if (count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}

/** The bell's accessible name. */
export function bellLabel(count: number): string {
  return `Notifications, ${Math.max(0, count)} unread`;
}

/** Shortens to at most `max` characters, ending in "…" when cut. Counts emoji as one. */
export function clip(text: string, max: number): string {
  const characters = Array.from(text);
  if (characters.length <= max) return text;
  return `${characters
    .slice(0, max - 1)
    .join("")
    .trimEnd()}…`;
}

/** A payload value as tidy text, or undefined when it is missing, blank or not text. */
function field(payload: Json, key: string): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = payload[key];
  if (typeof value !== "string") return undefined;
  return value.replace(/\s+/g, " ").trim() || undefined;
}

function statusLabel(payload: Json, labelKey: string, valueKey: string): string | undefined {
  const label = field(payload, labelKey);
  if (label) return clip(label, PERSON_MAX);
  const value = field(payload, valueKey);
  return value ? (DEFAULT_STATUS_LABELS[value] ?? clip(value, PERSON_MAX)) : undefined;
}

/** Tasks open in My Tasks, which can show any task the person can see; projects in Projects. */
export function notificationHref(
  notification: Pick<InAppNotification, "kind" | "task_id" | "project_id">,
): string {
  const { kind, task_id: taskId, project_id: projectId } = notification;
  if (kind !== "project_member_added" && taskId) {
    return `/my-tasks?task=${encodeURIComponent(taskId)}`;
  }
  if (projectId) return `/projects?project=${encodeURIComponent(projectId)}`;
  return taskId ? `/my-tasks?task=${encodeURIComponent(taskId)}` : "/";
}

/**
 * The sentence a notification reads as: "Arjun assigned you “Fee follow-up”",
 * with the project, the old status or the comment underneath. Every payload field
 * may be missing (an older row, a deleted name), so each has a fallback.
 */
export function describeNotification(
  notification: Pick<InAppNotification, "kind" | "task_id" | "project_id" | "payload">,
): NotificationView {
  const { payload } = notification;
  const actor = clip(field(payload, "actorName") ?? "Someone", PERSON_MAX);
  const taskTitle = field(payload, "taskTitle");
  const projectName = field(payload, "projectName");
  const task = taskTitle ? `“${clip(taskTitle, NAME_MAX)}”` : "a task";
  const project = projectName ? clip(projectName, NAME_MAX) : undefined;
  const href = notificationHref(notification);
  const view = (title: string, ...details: (string | undefined)[]): NotificationView => ({
    title,
    description: details.filter(Boolean).join(" · "),
    href,
  });

  switch (notification.kind) {
    case "task_assigned":
      return view(`${actor} assigned you ${task}`, project);
    case "task_review_requested":
      return view(`${actor} sent ${task} for your review`, project);
    case "task_completed":
      return view(`${actor} completed ${task}`, project);
    case "task_status_changed": {
      const to = statusLabel(payload, "toLabel", "to");
      const from = statusLabel(payload, "fromLabel", "from");
      return view(
        to ? `${actor} moved ${task} to ${to}` : `${actor} changed the status of ${task}`,
        from ? `Was ${from}` : undefined,
        project,
      );
    }
    case "task_commented": {
      const excerpt = field(payload, "excerpt");
      return view(`${actor} commented on ${task}`, excerpt ? clip(excerpt, EXCERPT_MAX) : project);
    }
    case "task_created_in_project": {
      const lead = taskTitle ? `New task ${task}` : "New task";
      return view(project ? `${lead} in ${project}` : lead, `Added by ${actor}`);
    }
    case "project_member_added": {
      const role = field(payload, "roleLabel");
      return view(
        project ? `Added to project “${project}”` : "Added to a project",
        role ? `${actor} added you as ${clip(role, PERSON_MAX)}` : `${actor} added you`,
      );
    }
    default:
      // A kind added to the database before the app knows it: still say something useful.
      return view(
        taskTitle ? `Update on ${task}` : project ? `Update in ${project}` : "New notification",
        taskTitle ? project : undefined,
      );
  }
}
