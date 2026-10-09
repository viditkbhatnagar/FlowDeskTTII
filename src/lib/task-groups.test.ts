// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import { foldGroups, groupSummary, indexTaskGroups, type GroupableTask } from "./task-groups";

const avatar = (name: string) => ({
  name,
  initials: name.slice(0, 2).toUpperCase(),
  color: `c-${name}`,
});

const task = (
  id: string,
  overrides: Partial<GroupableTask> & { assigneeName?: string } = {},
): GroupableTask => {
  const { assigneeName, ...rest } = overrides;
  return {
    id,
    title: `Task ${id}`,
    parentTaskId: null,
    assigneeId: assigneeName ? `u-${assigneeName}` : null,
    assignee: avatar(assigneeName ?? "Unassigned"),
    status: "todo",
    ...rest,
  };
};

const parent = task("p", { title: "Prepare the open day", status: "todo" });
const asha = task("c-asha", { parentTaskId: "p", assigneeName: "Asha", status: "done" });
const ben = task("c-ben", { parentTaskId: "p", assigneeName: "Ben", status: "todo" });
const cara = task("c-cara", { parentTaskId: "p", assigneeName: "Cara", status: "review" });
const solo = task("solo", { assigneeName: "Dan", status: "progress" });
const unassigned = task("loose");

describe("indexTaskGroups", () => {
  test("a task with no assignee that children point at is a group, with its members by name", () => {
    const { groups } = indexTaskGroups([cara, parent, solo, ben, asha]);
    expect([...groups.keys()]).toEqual(["p"]);
    const group = groups.get("p");
    expect(group?.members.map((m) => m.name)).toEqual(["Asha", "Ben", "Cara"]);
    expect(group?.members.map((m) => m.status)).toEqual(["done", "todo", "review"]);
    expect(group?.members[0]).toMatchObject({
      taskId: "c-asha",
      assigneeId: "u-Asha",
      color: "c-Asha",
    });
    expect(group).toMatchObject({ done: 1, total: 3 });
  });

  test("each child knows its parent", () => {
    const { parentOf } = indexTaskGroups([parent, asha, ben, solo]);
    expect(parentOf.get("c-asha")?.title).toBe("Prepare the open day");
    expect(parentOf.get("c-ben")?.id).toBe("p");
    expect(parentOf.has("solo")).toBe(false);
  });

  test("only the members the viewer can see are listed", () => {
    const { groups } = indexTaskGroups([parent, ben]);
    expect(groups.get("p")?.members.map((m) => m.name)).toEqual(["Ben"]);
    expect(groups.get("p")).toMatchObject({ done: 0, total: 1 });
  });

  test("a child whose parent is not visible has no group and no parent", () => {
    const { groups, parentOf } = indexTaskGroups([asha, solo]);
    expect(groups.size).toBe(0);
    expect(parentOf.size).toBe(0);
  });

  test("an unassigned task with no children is an ordinary task", () => {
    expect(indexTaskGroups([unassigned, solo]).groups.size).toBe(0);
  });

  test("a task with an assignee is never a group, even if something points at it", () => {
    const odd = task("odd", { parentTaskId: "solo", assigneeName: "Eve" });
    const { groups, parentOf } = indexTaskGroups([solo, odd]);
    expect(groups.size).toBe(0);
    expect(parentOf.size).toBe(0);
  });

  test("members sharing a name keep a stable order", () => {
    const twinB = task("c-2", { parentTaskId: "p", assigneeName: "Sam" });
    const twinA = task("c-1", { parentTaskId: "p", assigneeName: "Sam" });
    expect(
      indexTaskGroups([parent, twinB, twinA])
        .groups.get("p")
        ?.members.map((m) => m.taskId),
    ).toEqual(["c-1", "c-2"]);
  });
});

describe("foldGroups", () => {
  test("children whose parent is in the list are folded into the parent's card", () => {
    expect(foldGroups([parent, asha, ben, cara, solo]).map((t) => t.id)).toEqual(["p", "solo"]);
  });

  test("a child keeps its own card when its parent is not in the list", () => {
    // e.g. the board is filtered to Ben's tasks, or the parent is hidden from the viewer.
    expect(foldGroups([ben, solo]).map((t) => t.id)).toEqual(["c-ben", "solo"]);
  });

  test("the order of the list is kept", () => {
    expect(foldGroups([solo, cara, parent, unassigned]).map((t) => t.id)).toEqual([
      "solo",
      "p",
      "loose",
    ]);
  });

  test("an empty list stays empty", () => {
    expect(foldGroups([])).toEqual([]);
  });
});

describe("groupSummary", () => {
  test("says how many people and how many are done", () => {
    expect(groupSummary({ total: 3, done: 1 })).toBe("3 people · 1 done");
    expect(groupSummary({ total: 1, done: 0 })).toBe("1 person · 0 done");
  });
});
