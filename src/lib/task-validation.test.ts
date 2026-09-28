// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import { validateTaskFields } from "./task-validation";

const base = { title: "Plan the October open day", dueDate: "2026-10-15", requireDueDate: true };

describe("project is required to create a task", () => {
  test("no project is refused with a clear message", () => {
    expect(validateTaskFields({ ...base, requireProject: true, projectId: null }).project).toBe(
      "Choose a project. Every task belongs to one.",
    );
    expect(validateTaskFields({ ...base, requireProject: true }).project).toBeDefined();
    expect(validateTaskFields({ ...base, requireProject: true, projectId: "" }).project).toBeDefined();
  });

  test("a chosen project passes", () => {
    const errors = validateTaskFields({ ...base, requireProject: true, projectId: "5b2f0c1e-8a0d-4a8e-9a55-0c2f7a1d9e10" });
    expect(errors.project).toBeUndefined();
    expect(Object.keys(errors)).toEqual([]);
  });

  test("forms that do not require a project are unaffected", () => {
    expect(validateTaskFields({ ...base, projectId: null }).project).toBeUndefined();
  });

  test("the other required fields still apply alongside it", () => {
    const errors = validateTaskFields({ title: "", requireDueDate: true, requireProject: true });
    expect(errors.title).toBe("Title is required.");
    expect(errors.dueDate).toBe("Due date is required.");
    expect(errors.project).toBeDefined();
  });
});
