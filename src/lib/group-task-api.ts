/**
 * Supabase calls behind group tasks and the management lines the task
 * permissions read (spec of 9 Oct 2026, sections B and C).
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { UnitLead } from "@/lib/task-permissions";

/** p_task of public.create_group_task: these keys, camelCase, exactly. */
export interface GroupTaskFields {
  organizationId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  /** yyyy-mm-dd. */
  dueDate: string | null;
  dueAt: string | null;
  /** yyyy-mm-dd. */
  startDate: string | null;
  estimatedHours: number | null;
  tags: string[];
  reviewerId: string | null;
}

export type GroupTaskResult = { ok: true; id: string } | { ok: false; error: string };

/** Distinct, non-empty ids, in the order given. */
export function distinctIds(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/** A person-readable reason for a refused create_group_task call. */
export function groupTaskError(error: { code?: string; message?: string } | null): string {
  const message = error?.message ?? "";
  // The function raises its own sentences (fewer than two people, someone not
  // in the organization) as 22023.
  if (error?.code === "22023" && message) return message;
  if (/row-level security|permission denied/i.test(message))
    return "You don't have permission to do that.";
  return "The task could not be created for these people. Please try again.";
}

/**
 * One parent task plus one task per person, created together (or not at all)
 * by the database. Resolves with the parent's id.
 */
export async function createGroupTask(
  fields: GroupTaskFields,
  assigneeIds: readonly string[],
  subtasks: readonly string[],
): Promise<GroupTaskResult> {
  const ids = distinctIds(assigneeIds);
  if (ids.length < 2) return { ok: false, error: "Choose at least two people for a group task." };
  const { data, error } = await supabase.rpc("create_group_task", {
    p_task: { ...fields } as unknown as Json,
    p_assignee_ids: ids,
    ...(subtasks.length ? { p_subtasks: [...subtasks] } : {}),
  });
  if (error || !data) {
    console.error("[flowdesk] create_group_task failed", error);
    return { ok: false, error: groupTaskError(error) };
  }
  return { ok: true, id: data };
}

export interface UnitLeads {
  departmentHeads: UnitLead[];
  teamLeads: UnitLead[];
}

export const NO_UNIT_LEADS: UnitLeads = { departmentHeads: [], teamLeads: [] };

/**
 * Department heads and team leads by user id. The admin snapshot keeps them
 * as display names, which two people can share; who manages whom must not
 * depend on a name. Every member can read their organization's departments
 * and teams. Null when the read failed.
 */
export async function loadUnitLeads(): Promise<UnitLeads | null> {
  const [departments, teams] = await Promise.all([
    supabase.from("departments").select("id, organization_id, head_user_id"),
    supabase.from("teams").select("id, organization_id, lead_user_id"),
  ]);
  if (departments.error || teams.error) {
    console.error(
      "[flowdesk] loading department heads and team leads failed",
      departments.error ?? teams.error,
    );
    return null;
  }
  return {
    departmentHeads: (departments.data ?? []).map((row) => ({
      id: row.id,
      orgId: row.organization_id,
      leadId: row.head_user_id,
    })),
    teamLeads: (teams.data ?? []).map((row) => ({
      id: row.id,
      orgId: row.organization_id,
      leadId: row.lead_user_id,
    })),
  };
}
