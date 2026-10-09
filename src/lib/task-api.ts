/**
 * Comments, activity and files for tasks and projects.
 *
 * Before this module the task modal rendered hardcoded comments, activity,
 * attachments and time logs for every task (QA FD-005, FD-007, FD-057, FD-058,
 * FD-060): nothing a user typed or uploaded was ever stored. Everything here
 * reads and writes the tables added in 20260925000000_task_collaboration.sql,
 * under the same RLS rule as the task itself.
 *
 * Authors and uploaders are always the signed-in user — the database fills
 * them from the session and refuses anything else — so the UI cannot credit a
 * comment to the wrong person the way the old "Alex Morgan · now" did.
 */
import { supabase } from "@/integrations/supabase/client";
import { parseLinkInput, safeHref, type LinkInput } from "@/lib/links";

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export interface PersonRef {
  id: string;
  name: string;
  initials: string;
  color: string;
}

const initialsOf = (value: string) =>
  value.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";

/** Stable per-person colour, so someone keeps the same avatar colour everywhere. */
export function colorFor(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return `oklch(0.7 0.15 ${[265, 30, 155, 300, 80, 200, 340, 120][hash % 8]})`;
}

export function personRef(id: string | null | undefined, name?: string | null): PersonRef {
  const display = name?.trim() || (id ? "Unknown" : "Unassigned");
  return { id: id ?? "", name: display, initials: initialsOf(display), color: colorFor(display) };
}

/** Resolve user ids to people in one query. Unknown ids come back as "Unknown". */
async function peopleById(ids: (string | null | undefined)[]): Promise<Map<string, PersonRef>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, PersonRef>();
  if (!wanted.length) return map;
  const { data } = await supabase.from("profiles").select("user_id, full_name, username").in("user_id", wanted);
  for (const row of data ?? []) {
    map.set(row.user_id, personRef(row.user_id, row.full_name || row.username));
  }
  for (const id of wanted) if (!map.has(id)) map.set(id, personRef(id, null));
  return map;
}

function fail(operation: string, error: unknown): null {
  console.error(`[flowdesk] ${operation} failed`, error);
  return null;
}

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

export interface TaskComment {
  id: string;
  taskId: string;
  author: PersonRef;
  body: string;
  createdAt: string;
  isMine: boolean;
}

export async function listComments(taskId: string): Promise<TaskComment[] | null> {
  const [{ data, error }, { data: auth }] = await Promise.all([
    supabase.from("task_comments").select("*").eq("task_id", taskId).order("created_at"),
    supabase.auth.getUser(),
  ]);
  if (error) return fail("listComments", error);
  const people = await peopleById((data ?? []).map((c) => c.author_id));
  return (data ?? []).map((c) => ({
    id: c.id,
    taskId: c.task_id,
    author: people.get(c.author_id) ?? personRef(c.author_id, null),
    body: c.body,
    createdAt: c.created_at,
    isMine: c.author_id === auth.user?.id,
  }));
}

export const COMMENT_MAX_LENGTH = 5000;

export async function addComment(taskId: string, body: string): Promise<TaskComment | null> {
  const text = body.trim();
  if (!text || text.length > COMMENT_MAX_LENGTH) return null;
  // author_id is deliberately omitted: the column defaults to auth.uid() and
  // RLS refuses any other value.
  const { data, error } = await supabase.from("task_comments").insert({ task_id: taskId, body: text }).select("*").single();
  if (error) return fail("addComment", error);
  const people = await peopleById([data.author_id]);
  return {
    id: data.id,
    taskId: data.task_id,
    author: people.get(data.author_id) ?? personRef(data.author_id, null),
    body: data.body,
    createdAt: data.created_at,
    isMine: true,
  };
}

export async function deleteComment(id: string): Promise<boolean> {
  const { error } = await supabase.from("task_comments").delete().eq("id", id);
  return error ? Boolean(fail("deleteComment", error)) : true;
}

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

export interface ActivityEntry {
  id: string;
  type: string;
  actor: PersonRef;
  occurredAt: string;
  details: Record<string, unknown>;
  taskId: string | null;
  projectId: string | null;
}

const statusWords: Record<string, string> = {
  todo: "To Do", progress: "In Progress", review: "Review", done: "Completed", cancelled: "Cancelled",
  planning: "Planning", active: "Active", on_hold: "On Hold", completed: "Completed", archived: "Archived",
};

/** The attachment and document triggers record details.kind = 'link' for a link. */
const isLinkActivity = (details: Record<string, unknown>) => details.kind === "link";

const addedLink = (details: Record<string, unknown>) => {
  const name = typeof details.file_name === "string" ? details.file_name.trim() : "";
  return name ? `added a link: ${name}` : "added a link";
};

/**
 * One human sentence per activity row, e.g. "moved this task to In Progress".
 *
 * Pass useTaskSettings().statusLabel as `label` so task statuses use the names
 * configured in Settings; the built-in words are only a fallback (FD-018).
 */
export function describeActivity(
  entry: ActivityEntry,
  subject: "task" | "project" = "task",
  label?: (value: string) => string,
): string {
  const d = entry.details ?? {};
  const to = (d as { to?: string }).to;
  const taskStatus = (value: string) => label?.(value) ?? statusWords[value] ?? value;
  switch (entry.type) {
    case "task_created": return `created this ${subject}`;
    case "task_completed": return `marked this task ${taskStatus("done")}`;
    case "task_review_submitted": return "sent this task for review";
    case "task_status_changed": return `moved this task to ${to ? taskStatus(to) : "a new status"}`;
    case "task_assignee_changed": return "changed the assignee";
    case "task_due_date_changed": return "changed the due date";
    case "task_updated": {
      const parts: string[] = [];
      if ("title" in d) parts.push("the title");
      if ("description" in d) parts.push("the description");
      if ("priority" in d) parts.push("the priority");
      if ("estimate" in d) parts.push("the estimate");
      return parts.length ? `edited ${parts.join(", ")}` : "edited this task";
    }
    case "task_commented": return "commented";
    case "task_file_attached":
      return isLinkActivity(d)
        ? addedLink(d)
        : `attached ${(d as { file_name?: string }).file_name ?? "a file"}`;
    case "task_archived": return "deleted this task";
    case "project_updated": {
      const status = (d as { status?: { to?: string } }).status?.to;
      return status ? `moved the project to ${statusWords[status] ?? status}` : "edited the project";
    }
    case "project_document_added":
      return isLinkActivity(d)
        ? addedLink(d)
        : `uploaded ${(d as { file_name?: string }).file_name ?? "a document"}`;
    case "milestone_completed": return "completed a milestone";
    default: return entry.type.replace(/_/g, " ");
  }
}

async function listActivity(column: "task_id" | "project_id", id: string, limit: number): Promise<ActivityEntry[] | null> {
  const { data, error } = await supabase
    .from("work_activity")
    .select("*")
    .eq(column, id)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) return fail(`listActivity(${column})`, error);
  const people = await peopleById((data ?? []).map((a) => a.actor_id));
  return (data ?? []).map((a) => ({
    id: a.id,
    type: a.event_type,
    actor: people.get(a.actor_id ?? "") ?? personRef(a.actor_id, null),
    occurredAt: a.occurred_at,
    details: (a.details as Record<string, unknown>) ?? {},
    taskId: a.task_id,
    projectId: a.project_id,
  }));
}

export const listTaskActivity = (taskId: string, limit = 50) => listActivity("task_id", taskId, limit);
export const listProjectActivity = (projectId: string, limit = 50) => listActivity("project_id", projectId, limit);

/** Most recent activity across the workspace, newest first (Team Tasks feed). */
export async function listRecentActivity(limit = 20): Promise<ActivityEntry[] | null> {
  const { data, error } = await supabase
    .from("work_activity")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) return fail("listRecentActivity", error);
  const people = await peopleById((data ?? []).map((a) => a.actor_id));
  return (data ?? []).map((a) => ({
    id: a.id,
    type: a.event_type,
    actor: people.get(a.actor_id ?? "") ?? personRef(a.actor_id, null),
    occurredAt: a.occurred_at,
    details: (a.details as Record<string, unknown>) ?? {},
    taskId: a.task_id,
    projectId: a.project_id,
  }));
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

export const FILE_RULES = {
  maxBytes: 25 * 1024 * 1024,
  /** Mirrors the bucket allow-list in the migration. The bucket is the real guard. */
  allowedTypes: [
    "application/pdf",
    "image/png", "image/jpeg", "image/gif", "image/webp",
    "text/plain", "text/csv", "application/json",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip",
  ],
  accept: ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip",
  label: "PDF, images, Office documents, text, CSV or ZIP, up to 25 MB",
};

/** Why a file cannot be uploaded, or null when it can. */
export function validateFile(file: File): string | null {
  if (file.size === 0) return "is empty";
  if (file.size > FILE_RULES.maxBytes) return `is ${formatBytes(file.size)} — the limit is 25 MB`;
  if (!FILE_RULES.allowedTypes.includes(file.type)) return "is not an allowed file type";
  return null;
}

/** "1.2 MB". A link has no size and shows "—". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface StoredItemBase {
  id: string;
  /** The file's name, or the name a link is listed under. */
  name: string;
  /** Which list it is in: a task's attachments or a project's documents. */
  bucket: "task-attachments" | "project-documents";
  uploadedBy: PersonRef;
  createdAt: string;
  isMine: boolean;
}

/** A file uploaded to a private storage bucket. */
export interface StoredUpload extends StoredItemBase {
  kind: "file";
  size: number;
  mimeType: string;
  path: string;
  url: null;
}

/**
 * A link to a document kept elsewhere (SharePoint, OneDrive, Google Docs), so
 * people edit it in place. No size, no storage object, nothing to download:
 * it opens in a new tab. Put `url` through safeHref() before using it.
 */
export interface StoredLink extends StoredItemBase {
  kind: "link";
  url: string;
  size: null;
  mimeType: null;
  path: null;
}

/** One row of task_attachments or project_documents: a file or a link. */
export type StoredFile = StoredUpload | StoredLink;

export interface UploadResult {
  uploaded: StoredUpload[];
  rejected: { name: string; reason: string }[];
}

const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";

async function uploadFiles(
  bucket: StoredFile["bucket"],
  organizationId: string,
  ownerId: string,
  files: File[],
  record: (file: File, path: string) => Promise<{ id: string; created_at: string } | null>,
): Promise<UploadResult> {
  const result: UploadResult = { uploaded: [], rejected: [] };
  const { data: auth } = await supabase.auth.getUser();
  const me = await peopleById([auth.user?.id]);

  for (const file of files) {
    const problem = validateFile(file);
    if (problem) {
      result.rejected.push({ name: file.name, reason: problem });
      continue;
    }
    const path = `${organizationId}/${ownerId}/${crypto.randomUUID()}-${safeName(file.name)}`;
    const { error: storageError } = await supabase.storage.from(bucket).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (storageError) {
      fail(`upload ${file.name}`, storageError);
      result.rejected.push({ name: file.name, reason: storageError.message || "could not be uploaded" });
      continue;
    }
    const row = await record(file, path);
    if (!row) {
      // Do not leave an orphan object behind if the metadata row was refused.
      await supabase.storage.from(bucket).remove([path]);
      result.rejected.push({ name: file.name, reason: "could not be saved" });
      continue;
    }
    result.uploaded.push({
      id: row.id,
      kind: "file",
      name: file.name,
      size: file.size,
      mimeType: file.type,
      path,
      url: null,
      bucket,
      uploadedBy: me.get(auth.user?.id ?? "") ?? personRef(auth.user?.id, null),
      createdAt: row.created_at,
      isMine: true,
    });
  }
  return result;
}

export function uploadTaskFiles(task: { id: string; organizationId: string }, files: File[]): Promise<UploadResult> {
  return uploadFiles("task-attachments", task.organizationId, task.id, files, async (file, path) => {
    const { data, error } = await supabase
      .from("task_attachments")
      .insert({ task_id: task.id, file_name: file.name, file_size: file.size, mime_type: file.type, storage_path: path })
      .select("id, created_at")
      .single();
    return error ? fail("record task attachment", error) : data;
  });
}

export function uploadProjectDocuments(project: { id: string; organizationId: string }, files: File[]): Promise<UploadResult> {
  return uploadFiles("project-documents", project.organizationId, project.id, files, async (file, path) => {
    const { data, error } = await supabase
      .from("project_documents")
      .insert({
        project_id: project.id,
        organization_id: project.organizationId,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        storage_path: path,
      })
      .select("id, created_at")
      .single();
    return error ? fail("record project document", error) : data;
  });
}

/** The columns task_attachments and project_documents share. */
interface StoredRow {
  id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  storage_path: string | null;
  link_url: string | null;
  uploaded_by: string;
  created_at: string;
}

function toStoredFile(
  bucket: StoredFile["bucket"],
  row: StoredRow,
  uploadedBy: PersonRef,
  isMine: boolean,
): StoredFile | null {
  const base = {
    id: row.id,
    name: row.file_name,
    bucket,
    uploadedBy,
    createdAt: row.created_at,
    isMine,
  };
  if (row.link_url !== null) {
    return { ...base, kind: "link", url: row.link_url, size: null, mimeType: null, path: null };
  }
  // The table CHECK makes every row a file or a link; anything else is skipped.
  if (row.storage_path === null) return null;
  return {
    ...base,
    kind: "file",
    size: row.file_size ?? 0,
    mimeType: row.mime_type ?? "",
    path: row.storage_path,
    url: null,
  };
}

async function mapFiles(bucket: StoredFile["bucket"], rows: StoredRow[]): Promise<StoredFile[]> {
  const [{ data: auth }, people] = await Promise.all([
    supabase.auth.getUser(),
    peopleById(rows.map((r) => r.uploaded_by)),
  ]);
  return rows.flatMap((r) => {
    const item = toStoredFile(
      bucket,
      r,
      people.get(r.uploaded_by) ?? personRef(r.uploaded_by, null),
      r.uploaded_by === auth.user?.id,
    );
    return item ? [item] : [];
  });
}

/** Files and links on a task, oldest first. */
export async function listTaskFiles(taskId: string): Promise<StoredFile[] | null> {
  const { data, error } = await supabase.from("task_attachments").select("*").eq("task_id", taskId).order("created_at");
  if (error) return fail("listTaskFiles", error);
  return mapFiles("task-attachments", data ?? []);
}

/** Files and links on a project, newest first. */
export async function listProjectDocuments(projectId: string): Promise<StoredFile[] | null> {
  const { data, error } = await supabase
    .from("project_documents")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) return fail("listProjectDocuments", error);
  return mapFiles("project-documents", data ?? []);
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

export type AddLinkResult = { ok: true; link: StoredLink } | { ok: false; error: string };

export interface AddLinksResult {
  added: StoredLink[];
  /** `reason` completes "<name> …", like UploadResult.rejected. */
  rejected: { name: string; reason: string }[];
}

const LINK_NOT_SAVED = "The link could not be saved. Please try again.";

/**
 * Check a link the same way the Add link form does, insert it, and return it
 * as a StoredLink. `insert` returns the new row, or null after logging why not.
 */
async function addLink(
  bucket: StoredFile["bucket"],
  input: LinkInput,
  insert: (link: LinkInput) => Promise<StoredRow | null>,
): Promise<AddLinkResult> {
  const parsed = parseLinkInput(input);
  if (!parsed.ok) {
    return { ok: false, error: parsed.errors.url ?? parsed.errors.name ?? LINK_NOT_SAVED };
  }
  const row = await insert(parsed.link);
  if (!row) return { ok: false, error: LINK_NOT_SAVED };
  const [stored] = await mapFiles(bucket, [row]);
  return stored?.kind === "link"
    ? { ok: true, link: stored }
    : { ok: false, error: LINK_NOT_SAVED };
}

/** Add a link to a task's attachments. uploaded_by is filled from the session. */
export function addTaskLink(task: { id: string }, link: LinkInput): Promise<AddLinkResult> {
  return addLink("task-attachments", link, async ({ url, name }) => {
    const { data, error } = await supabase
      .from("task_attachments")
      .insert({ task_id: task.id, file_name: name, link_url: url })
      .select("*")
      .single();
    return error ? fail("record task link", error) : data;
  });
}

/** Add a link to a project's documents. uploaded_by is filled from the session. */
export function addProjectLink(
  project: { id: string; organizationId: string },
  link: LinkInput,
): Promise<AddLinkResult> {
  return addLink("project-documents", link, async ({ url, name }) => {
    const { data, error } = await supabase
      .from("project_documents")
      .insert({
        project_id: project.id,
        organization_id: project.organizationId,
        file_name: name,
        link_url: url,
      })
      .select("*")
      .single();
    return error ? fail("record project link", error) : data;
  });
}

async function addEach(
  links: LinkInput[],
  add: (link: LinkInput) => Promise<AddLinkResult>,
): Promise<AddLinksResult> {
  const result: AddLinksResult = { added: [], rejected: [] };
  // One at a time, so they are listed in the order they were added.
  for (const link of links) {
    const outcome = await add(link);
    if (outcome.ok) result.added.push(outcome.link);
    else result.rejected.push({ name: link.name || link.url, reason: "could not be saved" });
  }
  return result;
}

/** Save links picked in a form once the task exists, the way uploadTaskFiles saves files. */
export function addTaskLinks(task: { id: string }, links: LinkInput[]): Promise<AddLinksResult> {
  return addEach(links, (link) => addTaskLink(task, link));
}

/** Save links picked in a form once the project exists, the way uploadProjectDocuments saves files. */
export function addProjectLinks(
  project: { id: string; organizationId: string },
  links: LinkInput[],
): Promise<AddLinksResult> {
  return addEach(links, (link) => addProjectLink(project, link));
}

/** Remove a file or a link. A link is only its row; a file also loses its storage object. */
export async function deleteStoredFile(file: StoredFile): Promise<boolean> {
  const table = file.bucket === "task-attachments" ? "task_attachments" : "project_documents";
  const { error } = await supabase.from(table).delete().eq("id", file.id);
  if (error) return Boolean(fail("delete file row", error));
  if (file.kind === "link") return true;
  const { error: storageError } = await supabase.storage.from(file.bucket).remove([file.path]);
  if (storageError) fail("delete file object", storageError);
  return true;
}

/**
 * Where to send the browser: a short-lived signed link to open or download a
 * private file, or the link itself for a link (null if it is not a safe web
 * link). A link has nothing to download — open it in a new tab instead.
 */
export async function fileUrl(file: StoredFile, download = false): Promise<string | null> {
  if (file.kind === "link") return safeHref(file.url);
  const { data, error } = await supabase.storage
    .from(file.bucket)
    .createSignedUrl(file.path, 60 * 10, download ? { download: file.name } : undefined);
  return error ? fail("fileUrl", error) : data.signedUrl;
}
