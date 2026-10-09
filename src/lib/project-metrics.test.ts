// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  groupParentIds,
  personalWork,
  projectHealth,
  projectProgress,
  workUnits,
} from "./project-metrics";

// A group task (a task for several people) is a parent with no assignee plus one child per
// person, each pointing at the parent. Rows here are shaped like work_tasks rows.
type Row = {
  id: string;
  status: string;
  assignee_id: string | null;
  parent_task_id: string | null;
};

const row = (id: string, status: string, assignee: string | null, parent: string | null = null) =>
  ({ id, status, assignee_id: assignee, parent_task_id: parent }) satisfies Row;

/** "Brochure" for Maya, Dan and Sam: two parts are done, so the group is where Sam is. */
const brochure = [
  row("group", "review", null),
  row("maya-part", "done", "maya", "group"),
  row("dan-part", "done", "dan", "group"),
  row("sam-part", "review", "sam", "group"),
];
const standalone = [row("solo-done", "done", "maya"), row("solo-open", "todo", "dan")];
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("workUnits: a group is one unit of work", () => {
  test("counts the group once, as its parent, and skips its children", () => {
    expect(ids(workUnits([...brochure, ...standalone]))).toEqual([
      "group",
      "solo-done",
      "solo-open",
    ]);
  });

  test("project progress counts the group once: 1 of 3 done, not 3 of 6", () => {
    const progress = projectProgress(workUnits([...brochure, ...standalone]));
    expect(progress).toEqual({ total: 3, done: 1, open: 2, percent: 33 });
    // Counted per row it would read 50% for a group that is not finished.
    expect(projectProgress([...brochure, ...standalone]).percent).toBe(50);
  });

  test("a finished group is one done task", () => {
    const finished = [
      row("g", "done", null),
      row("a", "done", "maya", "g"),
      row("b", "done", "dan", "g"),
    ];
    expect(projectProgress(workUnits(finished))).toEqual({
      total: 1,
      done: 1,
      open: 0,
      percent: 100,
    });
  });

  test("a part whose group the viewer cannot see counts as a unit of its own", () => {
    // A manager who sees only their report's part, as the boards show it: a card of its own.
    expect(ids(workUnits([row("dan-part", "done", "dan", "group")]))).toEqual(["dan-part"]);
    expect(ids(workUnits([brochure[2], brochure[3], ...standalone]))).toEqual([
      "dan-part",
      "sam-part",
      "solo-done",
      "solo-open",
    ]);
  });

  test("reads the app's camelCase too", () => {
    const camel = [
      { id: "g", status: "todo", parentTaskId: null },
      { id: "a", status: "todo", parentTaskId: "g" },
    ];
    expect(ids(workUnits(camel))).toEqual(["g"]);
    expect(ids(personalWork(camel))).toEqual(["a"]);
  });

  test("tasks without the key (a database before group tasks) are each a unit", () => {
    const old = [
      { id: "x", status: "done" },
      { id: "y", status: "todo" },
    ];
    expect(ids(workUnits(old))).toEqual(["x", "y"]);
    expect(ids(personalWork(old))).toEqual(["x", "y"]);
  });
});

describe("personalWork: a person's numbers count their part, never the group", () => {
  test("drops group parents and keeps every part and standalone task", () => {
    expect(ids(personalWork([...brochure, ...standalone]))).toEqual([
      "maya-part",
      "dan-part",
      "sam-part",
      "solo-done",
      "solo-open",
    ]);
  });

  test("workload by assignee: one task each from the group", () => {
    const open = personalWork([...brochure, ...standalone]).filter((r) => r.status !== "done");
    const perPerson = Object.fromEntries(
      ["maya", "dan", "sam"].map((who) => [who, open.filter((r) => r.assignee_id === who).length]),
    );
    expect(perPerson).toEqual({ maya: 0, dan: 1, sam: 1 });
  });

  test("groupParentIds finds the parents a list points at", () => {
    expect([...groupParentIds([...brochure, ...standalone])]).toEqual(["group"]);
  });
});

describe("projectProgress and projectHealth", () => {
  test("cancelled work is neither done nor outstanding", () => {
    expect(
      projectProgress([{ status: "done" }, { status: "cancelled" }, { status: "todo" }]),
    ).toEqual({ total: 2, done: 1, open: 1, percent: 50 });
    expect(projectProgress([])).toEqual({ total: 0, done: 0, open: 0, percent: 0 });
  });

  test("health follows progress, the deadline and overdue work", () => {
    const today = "2026-10-09";
    const half = projectProgress([{ status: "done" }, { status: "todo" }]);
    expect(projectHealth({ progress: half, dueDate: "2026-12-31", today })).toBe("on-track");
    expect(projectHealth({ progress: half, dueDate: "2026-10-01", today })).toBe("delayed");
    expect(projectHealth({ progress: half, dueDate: "2026-12-31", today, overdueTasks: 1 })).toBe(
      "delayed",
    );
    const little = projectProgress([{ status: "done" }, { status: "todo" }, { status: "todo" }]);
    expect(projectHealth({ progress: little, dueDate: "2026-10-20", today })).toBe("at-risk");
    expect(projectHealth({ progress: projectProgress([]), today })).toBe("no-tasks");
    const allDone = projectProgress(
      workUnits([row("g", "done", null), row("a", "done", "m", "g")]),
    );
    expect(projectHealth({ progress: allDone, dueDate: "2026-10-01", today })).toBe("completed");
  });
});
