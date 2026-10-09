// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import { dashboardCounts } from "./dashboard.functions";

// What the dashboard counts from the tasks row-level security shows the user. A group task is a
// parent (no assignee) plus one child per person.
const ME = "me";
const row = (id: string, assignee: string | null, parent: string | null = null) => ({
  id,
  assignee_id: assignee,
  parent_task_id: parent,
});

const visible = [
  row("group", null),
  row("my-part", ME, "group"),
  row("dan-part", "dan", "group"),
  row("mine", ME),
  row("dans", "dan"),
  // A report's part of someone else's group: the user cannot see that group.
  row("sam-part", "sam", "hidden-group"),
];
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("dashboardCounts", () => {
  test("Team Overview counts each group once, as the Team board shows it", () => {
    const { tasks, units } = dashboardCounts(visible, "team", ME);
    expect(ids(tasks)).toEqual(["group", "mine", "dans", "sam-part"]);
    expect(units).toEqual(tasks);
  });

  test("Team Workload counts each person's part, never the group", () => {
    const { people } = dashboardCounts(visible, "team", ME);
    expect(ids(people)).toEqual(["my-part", "dan-part", "mine", "dans", "sam-part"]);
  });

  test("My Overview is the user's own work: their part, never the group", () => {
    const { tasks, people } = dashboardCounts(visible, "mine", ME);
    expect(ids(tasks)).toEqual(["my-part", "mine"]);
    expect(people).toEqual(tasks);
  });

  test("project progress counts groups once in either scope", () => {
    for (const scope of ["mine", "team"] as const) {
      expect(ids(dashboardCounts(visible, scope, ME).units)).toEqual([
        "group",
        "mine",
        "dans",
        "sam-part",
      ]);
    }
  });
});
