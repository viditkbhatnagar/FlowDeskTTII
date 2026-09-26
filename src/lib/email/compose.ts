import {
  dailyDigestContent,
  dailyManagementContent,
  weeklyDigestContent,
  weeklyManagementContent,
  type DigestArgs,
} from "./digests";
import { MANAGEMENT_KINDS, SCHEDULED_KINDS, type EmailKind, type PreferenceKind } from "./kinds";
import {
  appUrls,
  contentOrgs,
  displayName,
  firstNameOf,
  indexSnapshot,
  isActiveMember,
  isOpenTask,
  kindEnabledForOrg,
  orgToday,
  preferenceOn,
  priorityLabel,
  projectNameOf,
  type SnapshotIndex,
} from "./lookup";
import {
  renderAccountAccess,
  renderDailyDigest,
  renderDailyManagement,
  renderDueReminder,
  renderOverdueAlert,
  renderProjectInvitation,
  renderTaskAssigned,
  renderWeeklyDigest,
  renderWeeklyManagement,
  type RenderContext,
  type RenderedEmail,
} from "./render";
import type {
  ClaimedEmail,
  EmailSnapshot,
  SnapshotOrganization,
  SnapshotPerson,
  SnapshotTask,
} from "./snapshot";
import { daysBetween, effectiveDue, formatDate, localParts } from "./time";

export type ComposeContext = { appUrl: string; now: Date };

export type ComposedEmail = {
  outcome: "send";
  to: string;
  toName: string;
  subject: string;
  html: string;
};
export type ComposeResult = ComposedEmail | { outcome: "suppress"; reason: string };

type Recipient = { person: SnapshotPerson; email: string; firstName: string; toName: string };

type Env = {
  row: ClaimedEmail;
  index: SnapshotIndex;
  ctx: ComposeContext;
  render: RenderContext;
  recipient: Recipient;
};

/** Thrown inside a composer to suppress the row; never escapes composeEmail. */
class Suppress extends Error {}

function suppress(reason: string): never {
  throw new Suppress(reason);
}

function resolveRecipient(row: ClaimedEmail, index: SnapshotIndex): Recipient {
  const person = row.recipientUserId ? index.personById.get(row.recipientUserId) : undefined;
  if (!person) return suppress("recipient no longer exists");
  if (person.status !== "active") return suppress("recipient is inactive");
  const email = (person.email ?? row.recipientEmail ?? "").trim();
  if (!email) return suppress("recipient has no email address");
  const payloadName = typeof row.payload.fullName === "string" ? row.payload.fullName : null;
  const named = { fullName: person.fullName?.trim() || payloadName, email };
  return { person, email, firstName: firstNameOf(named), toName: named.fullName?.trim() || "" };
}

const SCHEDULED: ReadonlySet<string> = new Set(SCHEDULED_KINDS);

/**
 * A scheduled row is about the local day it was planned on (payload.localDate). A retry or a late
 * claim that lands after local midnight would fill it with the next day's tasks, so it is dropped.
 */
function requirePlannedDay(row: ClaimedEmail, index: SnapshotIndex, now: Date) {
  if (!SCHEDULED.has(row.kind)) return;
  const { localDate, timezone } = row.payload;
  if (typeof localDate !== "string") return;
  const zone =
    typeof timezone === "string" ? timezone : index.orgById.get(row.organizationId ?? "")?.timezone;
  if (!zone) return;
  const today = localParts(now, zone).date;
  if (today !== localDate) suppress(`planned for ${localDate}, but it is now ${today} in ${zone}`);
}

function requirePreference(env: Env, kind: PreferenceKind) {
  if (!preferenceOn(env.index, env.recipient.person.userId, kind)) {
    suppress(`recipient turned off ${kind}`);
  }
}

function requireOrgKind(env: Env, orgId: string, kind: PreferenceKind): SnapshotOrganization {
  const org = env.index.orgById.get(orgId);
  if (!org) return suppress("organization no longer exists");
  if (!kindEnabledForOrg(org, kind)) suppress(`${kind} is switched off for ${org.name}`);
  if (!isActiveMember(env.index, env.recipient.person.userId, org.id)) {
    suppress("recipient is no longer an active member of the organization");
  }
  return org;
}

function requireOpenTask(env: Env): SnapshotTask {
  const task = env.row.taskId ? env.index.taskById.get(env.row.taskId) : undefined;
  if (!task) return suppress("task no longer exists or is archived");
  if (!isOpenTask(task)) suppress(`task is ${task.status}`);
  if (task.assigneeId !== env.recipient.person.userId) suppress("task was reassigned");
  return task;
}

function taskDetails(env: Env, task: SnapshotTask, org: SnapshotOrganization) {
  const due = effectiveDue(task, org.timezone);
  return {
    firstName: env.recipient.firstName,
    taskTitle: task.title,
    organizationName: org.name,
    projectName: projectNameOf(env.index, task.projectId),
    priority: priorityLabel(env.index, org.id, task.priority),
    dueDate: due ? formatDate(due) : "",
    taskUrl: appUrls(env.ctx.appUrl).myTask(task.id),
  };
}

/**
 * The one-time setup token that admin_create_user / admin_resend_welcome put on the row: 32 random
 * bytes as lowercase hex (encode(…, 'hex')). The database keeps only its sha256 and strips it from
 * the payload once the row is settled. It is a password-equivalent secret: it goes into the link
 * and nowhere else (never a log line, a subject or an error).
 */
const SETUP_TOKEN = /^[0-9a-f]{64}$/;

/**
 * The one-time /welcome link when the row carries a setup token, else the reset-password flow.
 * The token rides in the fragment (#token=…), never the query: a browser does not send the
 * fragment to any server or in a Referer, so it stays out of the nginx access log. The page reads
 * it in the browser and removes it from the address bar straight away.
 */
function setPasswordLink(env: Env): { url: string; singleUse: boolean } {
  const token = env.row.payload.setupToken;
  if (typeof token === "string" && SETUP_TOKEN.test(token)) {
    return { url: `${env.ctx.appUrl}/welcome#token=${token}`, singleUse: true };
  }
  const email = encodeURIComponent(env.recipient.email);
  return { url: `${env.ctx.appUrl}/auth?mode=reset&email=${email}`, singleUse: false };
}

function composeAccountAccess(env: Env): RenderedEmail {
  // Queued by a first membership; an admin who removes it again before the send withdraws it.
  if (!env.index.activeOrgsByUser.get(env.recipient.person.userId)?.length)
    suppress("recipient no longer belongs to any organization");
  const link = setPasswordLink(env);
  return renderAccountAccess(
    {
      firstName: env.recipient.firstName,
      emailAddress: env.recipient.email,
      setPasswordUrl: link.url,
      singleUseLink: link.singleUse,
      signInUrl: `${env.ctx.appUrl}/auth`,
    },
    env.render,
  );
}

function composeProjectInvitation(env: Env): RenderedEmail {
  requirePreference(env, "project_invitation");
  const userId = env.recipient.person.userId;
  const project = env.row.projectId ? env.index.projectById.get(env.row.projectId) : undefined;
  if (!project || project.status === "archived")
    return suppress("project no longer exists or is archived");
  if (project.status === "cancelled") suppress("project was cancelled");
  const memberKey = `${project.id}:${userId}`;
  if (!env.index.projectRoleLabels.has(memberKey))
    suppress("recipient is no longer a project member");
  const org = requireOrgKind(env, project.organizationId, "project_invitation");
  const payloadRole =
    typeof env.row.payload.roleLabel === "string" ? env.row.payload.roleLabel.trim() : "";
  return renderProjectInvitation(
    {
      firstName: env.recipient.firstName,
      inviterName: displayName(env.index, env.row.actorId),
      organizationName: org.name,
      projectName: project.name,
      projectRole:
        payloadRole || env.index.projectRoleLabels.get(memberKey)?.trim() || "Team member",
      projectUrl: appUrls(env.ctx.appUrl).project(project.id),
    },
    env.render,
  );
}

function composeTaskAssigned(env: Env): RenderedEmail {
  requirePreference(env, "task_assigned");
  const task = requireOpenTask(env);
  const org = requireOrgKind(env, task.organizationId, "task_assigned");
  return renderTaskAssigned(
    { ...taskDetails(env, task, org), assignedBy: displayName(env.index, env.row.actorId) },
    env.render,
  );
}

/** The task's due day now, which must still be the day the row was planned for. */
function requirePlannedDue(env: Env, task: SnapshotTask, org: SnapshotOrganization): string {
  const planned = typeof env.row.payload.due === "string" ? env.row.payload.due : null;
  const due = effectiveDue(task, org.timezone);
  if (!due || due !== planned) suppress("due date changed since the email was planned");
  return due;
}

function composeDueReminder(env: Env): RenderedEmail {
  requirePreference(env, "due_reminder");
  const task = requireOpenTask(env);
  const org = requireOrgKind(env, task.organizationId, "due_reminder");
  requirePlannedDue(env, task, org);
  return renderDueReminder(taskDetails(env, task, org), env.render);
}

function composeOverdueAlert(env: Env): RenderedEmail {
  requirePreference(env, "overdue_alert");
  const task = requireOpenTask(env);
  const org = requireOrgKind(env, task.organizationId, "overdue_alert");
  const due = requirePlannedDue(env, task, org);
  const days = Math.max(1, daysBetween(due, orgToday(org, env.ctx.now)));
  return renderOverdueAlert(
    { ...taskDetails(env, task, org), overdueDuration: days === 1 ? "1 day" : `${days} days` },
    env.render,
  );
}

type SummaryKind = "daily_digest" | "weekly_digest" | "daily_management" | "weekly_management";

const SUMMARIES: Record<
  SummaryKind,
  (args: DigestArgs, render: RenderContext) => RenderedEmail | null
> = {
  daily_digest: (args, render) => {
    const content = dailyDigestContent(args);
    return content && renderDailyDigest(content, render);
  },
  weekly_digest: (args, render) => {
    const content = weeklyDigestContent(args);
    return content && renderWeeklyDigest(content, render);
  },
  daily_management: (args, render) => {
    const content = dailyManagementContent(args);
    return content && renderDailyManagement(content, render);
  },
  weekly_management: (args, render) => {
    const content = weeklyManagementContent(args);
    return content && renderWeeklyManagement(content, render);
  },
};

function composeSummary(env: Env, kind: SummaryKind): RenderedEmail {
  requirePreference(env, kind);
  const userId = env.recipient.person.userId;
  const management = (MANAGEMENT_KINDS as readonly string[]).includes(kind);
  if (contentOrgs(env.index, userId, kind, management).length === 0) {
    suppress(
      management
        ? `${kind}: recipient manages no organization with it switched on`
        : `${kind} is switched off for every organization of the recipient`,
    );
  }
  const args: DigestArgs = { index: env.index, userId, now: env.ctx.now, appUrl: env.ctx.appUrl };
  return SUMMARIES[kind](args, env.render) ?? suppress("nothing to report");
}

const COMPOSERS: Record<EmailKind, (env: Env) => RenderedEmail> = {
  account_access: composeAccountAccess,
  project_invitation: composeProjectInvitation,
  task_assigned: composeTaskAssigned,
  due_reminder: composeDueReminder,
  overdue_alert: composeOverdueAlert,
  daily_digest: (env) => composeSummary(env, "daily_digest"),
  weekly_digest: (env) => composeSummary(env, "weekly_digest"),
  daily_management: (env) => composeSummary(env, "daily_management"),
  weekly_management: (env) => composeSummary(env, "weekly_management"),
};

/**
 * Turn one claimed outbox row into an email, against the current snapshot. Pure. Anything that
 * changed since the row was queued (reassigned, closed, opted out, …) suppresses it instead.
 * Programming errors are not caught here: the worker records them as failures.
 */
export function composeEmail(
  row: ClaimedEmail,
  snapshot: EmailSnapshot,
  ctx: ComposeContext,
): ComposeResult {
  const composer = COMPOSERS[row.kind];
  if (!composer) return { outcome: "suppress", reason: `unknown email kind: ${String(row.kind)}` };
  try {
    const index = indexSnapshot(snapshot);
    const recipient = resolveRecipient(row, index);
    requirePlannedDay(row, index, ctx.now);
    const env: Env = { row, index, ctx, recipient, render: { assetBaseUrl: ctx.appUrl } };
    const email = composer(env);
    return { outcome: "send", to: recipient.email, toName: recipient.toName, ...email };
  } catch (error) {
    if (error instanceof Suppress) return { outcome: "suppress", reason: error.message };
    throw error;
  }
}
