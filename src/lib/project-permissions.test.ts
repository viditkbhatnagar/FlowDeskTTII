// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  canCreateProjects,
  canDeleteProjects,
  canManageProject,
  hasProjectOversight,
} from "./project-permissions";

const ME = "20000000-0000-4000-8000-000000000002";
const OTHER = "30000000-0000-4000-8000-000000000003";

/** Someone else's project, with me nowhere on it. */
const theirs = { ownerId: OTHER, managerId: OTHER, memberIds: [OTHER] };

describe("managing a project", () => {
  test("admins and managers of its organization manage every project there", () => {
    expect(canManageProject(ME, ["admin"], theirs)).toBe(true);
    expect(canManageProject(ME, ["manager"], theirs)).toBe(true);
    expect(canManageProject(ME, ["employee", "manager"], theirs)).toBe(true);
  });

  test("its owner and its Project Manager manage it, whatever their role", () => {
    expect(canManageProject(ME, ["employee"], { ...theirs, ownerId: ME })).toBe(true);
    expect(canManageProject(ME, ["employee"], { ...theirs, managerId: ME })).toBe(true);
    expect(canManageProject(ME, [], { ...theirs, managerId: ME })).toBe(true);
  });

  test("a team lead manages it only when on its team", () => {
    expect(canManageProject(ME, ["team_lead"], theirs)).toBe(false);
    expect(canManageProject(ME, ["team_lead"], { ...theirs, memberIds: [OTHER, ME] })).toBe(true);
  });

  test("a team member who is not a team lead may work on it but not manage it", () => {
    expect(canManageProject(ME, ["employee"], { ...theirs, memberIds: [ME] })).toBe(false);
    expect(canManageProject(ME, ["viewer"], { ...theirs, memberIds: [ME] })).toBe(false);
  });

  test("nobody is matched as owner before the signed-in user is known", () => {
    expect(
      canManageProject(null, ["employee"], { ownerId: null, managerId: null, memberIds: [] }),
    ).toBe(false);
  });
});

describe("creating and deleting projects", () => {
  test("creating (and duplicating) takes admin, manager or team lead", () => {
    expect(canCreateProjects(["admin"])).toBe(true);
    expect(canCreateProjects(["manager"])).toBe(true);
    expect(canCreateProjects(["team_lead"])).toBe(true);
    expect(canCreateProjects(["employee"])).toBe(false);
    expect(canCreateProjects([])).toBe(false);
  });

  test("deleting takes an admin", () => {
    expect(canDeleteProjects(["admin"])).toBe(true);
    expect(canDeleteProjects(["manager"])).toBe(false);
  });

  test("oversight is admin or manager, never team lead", () => {
    expect(hasProjectOversight(["team_lead"])).toBe(false);
    expect(hasProjectOversight(["manager"])).toBe(true);
  });
});
