// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  bellLabel,
  clip,
  describeNotification,
  mergeNotifications,
  newestCreatedAt,
  NOTIFICATION_KINDS,
  notificationHref,
  timestampMs,
  toNotification,
  unreadBadge,
  unseenUnread,
  type InAppNotification,
} from "./in-app-notifications";

const TASK_ID = "5b2f0c1e-8a0d-4a8e-9a55-0c2f7a1d9e10";
const PROJECT_ID = "0f7c1d2e-3b4a-4c5d-8e9f-a0b1c2d3e4f5";

function notification(overrides: Partial<InAppNotification> = {}): InAppNotification {
  return {
    id: "n-1",
    kind: "task_assigned",
    actor_id: "actor-1",
    task_id: TASK_ID,
    project_id: PROJECT_ID,
    payload: { actorName: "Arjun", taskTitle: "Fee follow-up", projectName: "Growth" },
    created_at: "2026-09-30T10:00:00.000Z",
    read_at: null,
    ...overrides,
  };
}

const describeKind = (kind: string, payload: InAppNotification["payload"]) =>
  describeNotification(notification({ kind, payload }));

describe("the sentence for each kind", () => {
  test("task_assigned", () => {
    const view = describeKind("task_assigned", {
      actorName: "Arjun",
      taskTitle: "Fee follow-up",
      projectName: "Growth",
    });
    expect(view.title).toBe("Arjun assigned you “Fee follow-up”");
    expect(view.description).toBe("Growth");
    expect(view.href).toBe(`/my-tasks?task=${TASK_ID}`);
  });

  test("task_review_requested", () => {
    const view = describeKind("task_review_requested", {
      actorName: "Maya",
      taskTitle: "Deck",
      projectName: "Growth",
    });
    expect(view.title).toBe("Maya sent “Deck” for your review");
    expect(view.description).toBe("Growth");
  });

  test("task_completed", () => {
    const view = describeKind("task_completed", { actorName: "Maya", taskTitle: "Deck" });
    expect(view.title).toBe("Maya completed “Deck”");
    expect(view.description).toBe("");
  });

  test("task_status_changed uses the organization's own labels", () => {
    const view = describeKind("task_status_changed", {
      actorName: "Maya",
      taskTitle: "Deck",
      projectName: "Growth",
      from: "todo",
      to: "progress",
      fromLabel: "Backlog",
      toLabel: "Doing",
    });
    expect(view.title).toBe("Maya moved “Deck” to Doing");
    expect(view.description).toBe("Was Backlog · Growth");
  });

  test("task_status_changed falls back to the built-in labels", () => {
    const view = describeKind("task_status_changed", {
      actorName: "Maya",
      taskTitle: "Deck",
      from: "todo",
      to: "progress",
    });
    expect(view.title).toBe("Maya moved “Deck” to In Progress");
    expect(view.description).toBe("Was To Do");
  });

  test("task_status_changed with no status at all", () => {
    const view = describeKind("task_status_changed", { actorName: "Maya", taskTitle: "Deck" });
    expect(view.title).toBe("Maya changed the status of “Deck”");
    expect(view.description).toBe("");
  });

  test("task_status_changed with an unknown status shows it as it is", () => {
    expect(
      describeKind("task_status_changed", { actorName: "Maya", taskTitle: "Deck", to: "on_hold" })
        .title,
    ).toBe("Maya moved “Deck” to on_hold");
  });

  test("task_commented shows the excerpt underneath", () => {
    const view = describeKind("task_commented", {
      actorName: "Maya",
      taskTitle: "Deck",
      projectName: "Growth",
      commentId: "c-1",
      excerpt: "Can you  send\nthe deck by Friday?",
    });
    expect(view.title).toBe("Maya commented on “Deck”");
    expect(view.description).toBe("Can you send the deck by Friday?");
  });

  test("task_commented without an excerpt shows the project", () => {
    expect(
      describeKind("task_commented", {
        actorName: "Maya",
        taskTitle: "Deck",
        projectName: "Growth",
      }).description,
    ).toBe("Growth");
  });

  test("task_created_in_project", () => {
    const view = describeKind("task_created_in_project", {
      actorName: "Maya",
      taskTitle: "X",
      projectName: "Growth",
    });
    expect(view.title).toBe("New task “X” in Growth");
    expect(view.description).toBe("Added by Maya");
  });

  test("project_member_added opens the project", () => {
    const view = describeNotification(
      notification({
        kind: "project_member_added",
        task_id: null,
        payload: { actorName: "Maya", projectName: "Growth", roleLabel: "Designer" },
      }),
    );
    expect(view.title).toBe("Added to project “Growth”");
    expect(view.description).toBe("Maya added you as Designer");
    expect(view.href).toBe(`/projects?project=${PROJECT_ID}`);
  });

  test("project_member_added without a role", () => {
    const view = describeNotification(
      notification({
        kind: "project_member_added",
        task_id: null,
        payload: { actorName: "Maya", projectName: "Growth", roleLabel: null },
      }),
    );
    expect(view.description).toBe("Maya added you");
  });

  test("an unknown kind still reads as something", () => {
    expect(describeKind("task_due_soon", { taskTitle: "Deck", projectName: "Growth" })).toEqual({
      title: "Update on “Deck”",
      description: "Growth",
      href: `/my-tasks?task=${TASK_ID}`,
    });
    expect(describeKind("something_new", {}).title).toBe("New notification");
  });

  test("every known kind has its own sentence", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const view = describeKind(kind, {
        actorName: "Maya",
        taskTitle: "Deck",
        projectName: "Growth",
      });
      expect(view.title).not.toBe("New notification");
      expect(view.title.startsWith("Update on")).toBe(false);
    }
  });
});

describe("missing payload fields", () => {
  test("no actor reads as Someone", () => {
    expect(describeKind("task_assigned", { taskTitle: "Deck" }).title).toBe(
      "Someone assigned you “Deck”",
    );
    expect(describeKind("task_created_in_project", { taskTitle: "Deck" }).description).toBe(
      "Added by Someone",
    );
  });

  test("no task title reads as a task", () => {
    expect(describeKind("task_assigned", { actorName: "Maya" }).title).toBe(
      "Maya assigned you a task",
    );
    expect(describeKind("task_completed", { actorName: "Maya" }).title).toBe(
      "Maya completed a task",
    );
    expect(describeKind("task_commented", { actorName: "Maya" }).title).toBe(
      "Maya commented on a task",
    );
    expect(describeKind("task_review_requested", { actorName: "Maya" }).title).toBe(
      "Maya sent a task for your review",
    );
    expect(describeKind("task_status_changed", { actorName: "Maya", to: "done" }).title).toBe(
      "Maya moved a task to Completed",
    );
  });

  test("no task title or project for a new task", () => {
    expect(describeKind("task_created_in_project", { actorName: "Maya" }).title).toBe("New task");
    expect(
      describeKind("task_created_in_project", { actorName: "Maya", projectName: "Growth" }).title,
    ).toBe("New task in Growth");
    expect(
      describeKind("task_created_in_project", { actorName: "Maya", taskTitle: "X" }).title,
    ).toBe("New task “X”");
  });

  test("no project name when added to a project", () => {
    const view = describeNotification(
      notification({ kind: "project_member_added", task_id: null, payload: {} }),
    );
    expect(view.title).toBe("Added to a project");
    expect(view.description).toBe("Someone added you");
  });

  test("blank, non-text and malformed payloads are treated as missing", () => {
    expect(
      describeKind("task_assigned", { actorName: "   ", taskTitle: 42, projectName: "" }).title,
    ).toBe("Someone assigned you a task");
    expect(
      describeKind("task_assigned", { actorName: "   ", taskTitle: 42, projectName: "" })
        .description,
    ).toBe("");
    expect(describeKind("task_assigned", null).title).toBe("Someone assigned you a task");
    expect(describeKind("task_assigned", ["Maya"]).title).toBe("Someone assigned you a task");
    expect(describeKind("task_assigned", "Maya").title).toBe("Someone assigned you a task");
  });
});

describe("long titles", () => {
  const long =
    "Follow up with every applicant who has not paid the October intake fee yet, by phone";

  test("a long task title is cut with an ellipsis", () => {
    const { title } = describeKind("task_assigned", { actorName: "Arjun", taskTitle: long });
    const quoted = title.slice("Arjun assigned you ".length);
    expect(quoted.startsWith("“Follow up with every applicant")).toBe(true);
    expect(quoted.endsWith("…”")).toBe(true);
    // 60 characters inside the quotes, including the ellipsis.
    expect(Array.from(quoted).length).toBe(62);
  });

  test("a long project name and excerpt are cut too", () => {
    const view = describeKind("task_commented", {
      actorName: "Maya",
      taskTitle: "Deck",
      excerpt: "word ".repeat(60),
    });
    expect(Array.from(view.description).length).toBeLessThanOrEqual(140);
    expect(view.description.endsWith("…")).toBe(true);
    const created = describeKind("task_created_in_project", {
      actorName: "Maya",
      taskTitle: "X",
      projectName: long,
    });
    expect(created.title.endsWith("…")).toBe(true);
  });

  test("a title that fits is left alone", () => {
    expect(
      describeKind("task_completed", { actorName: "Maya", taskTitle: "a".repeat(60) }).title,
    ).toBe(`Maya completed “${"a".repeat(60)}”`);
  });

  test("clip does not split an emoji", () => {
    expect(clip("🎉🎉🎉🎉", 3)).toBe("🎉🎉…");
    expect(clip("short", 10)).toBe("short");
  });
});

describe("where a notification opens", () => {
  test("task kinds open the task in My Tasks", () => {
    for (const kind of NOTIFICATION_KINDS.filter((k) => k !== "project_member_added")) {
      expect(notificationHref({ kind, task_id: TASK_ID, project_id: PROJECT_ID })).toBe(
        `/my-tasks?task=${TASK_ID}`,
      );
    }
  });

  test("project_member_added opens the project", () => {
    expect(
      notificationHref({ kind: "project_member_added", task_id: null, project_id: PROJECT_ID }),
    ).toBe(`/projects?project=${PROJECT_ID}`);
  });

  test("falls back sensibly when ids are missing", () => {
    expect(notificationHref({ kind: "task_assigned", task_id: null, project_id: PROJECT_ID })).toBe(
      `/projects?project=${PROJECT_ID}`,
    );
    expect(notificationHref({ kind: "task_assigned", task_id: null, project_id: null })).toBe("/");
  });
});

describe("the bell", () => {
  test("badge", () => {
    expect(unreadBadge(0)).toBe("");
    expect(unreadBadge(-1)).toBe("");
    expect(unreadBadge(1)).toBe("1");
    expect(unreadBadge(9)).toBe("9");
    expect(unreadBadge(10)).toBe("9+");
    expect(unreadBadge(250)).toBe("9+");
  });

  test("accessible name", () => {
    expect(bellLabel(3)).toBe("Notifications, 3 unread");
    expect(bellLabel(0)).toBe("Notifications, 0 unread");
  });
});

describe("merging and spotting new ones", () => {
  const a = notification({ id: "a", created_at: "2026-09-30T10:00:00.000Z" });
  const b = notification({ id: "b", created_at: "2026-09-30T11:00:00.000Z" });
  const c = notification({ id: "c", created_at: "2026-09-30T12:00:00.000Z" });

  test("merges by id, newest first, capped", () => {
    expect(mergeNotifications([a, b], [c, b]).map((n) => n.id)).toEqual(["c", "b", "a"]);
    expect(mergeNotifications([a, b], [c], 2).map((n) => n.id)).toEqual(["c", "b"]);
  });

  test("a late poll cannot make a clicked notification unread again", () => {
    const readA = { ...a, read_at: "2026-09-30T12:30:00.000Z" };
    const merged = mergeNotifications([readA], [a]);
    expect(merged[0].read_at).toBe("2026-09-30T12:30:00.000Z");
    // A read that arrives from another tab still lands.
    expect(mergeNotifications([a], [readA])[0].read_at).toBe("2026-09-30T12:30:00.000Z");
  });

  test("does not change the list it was given", () => {
    const current = [a];
    mergeNotifications(current, [b]);
    expect(current).toEqual([a]);
  });

  test("unseenUnread skips known, read and repeated rows, oldest first", () => {
    const readC = { ...c, read_at: "2026-09-30T12:01:00.000Z" };
    const fresh = unseenUnread(new Set(["a"]), [
      b,
      a,
      readC,
      b,
      notification({ id: "d", created_at: "2026-09-30T09:00:00.000Z" }),
    ]);
    expect(fresh.map((n) => n.id)).toEqual(["d", "b"]);
  });

  test("newestCreatedAt", () => {
    expect(newestCreatedAt([a, c, b])).toBe(c.created_at);
    expect(newestCreatedAt([a], c.created_at)).toBe(c.created_at);
    expect(newestCreatedAt([])).toBeUndefined();
  });
});

describe("rows from the database and from Realtime", () => {
  test("Postgres-style timestamps are read", () => {
    expect(timestampMs("2026-09-30 10:00:00.123456+00")).toBe(
      Date.parse("2026-09-30T10:00:00.123Z"),
    );
    expect(timestampMs("2026-09-30T10:00:00.123456+00:00")).toBe(
      Date.parse("2026-09-30T10:00:00.123Z"),
    );
    expect(timestampMs("2026-09-30T15:30:00+05:30")).toBe(Date.parse("2026-09-30T10:00:00Z"));
    expect(timestampMs("not a date")).toBe(0);
  });

  test("a Realtime record becomes a notification with ISO times", () => {
    const row = toNotification({
      id: "n-9",
      recipient_id: "me",
      organization_id: "org",
      kind: "task_completed",
      actor_id: "actor",
      task_id: TASK_ID,
      project_id: null,
      payload: { actorName: "Maya" },
      dedupe_key: "task_completed:x",
      created_at: "2026-09-30 10:00:00.5+00",
      read_at: null,
    });
    expect(row).toEqual({
      id: "n-9",
      kind: "task_completed",
      actor_id: "actor",
      task_id: TASK_ID,
      project_id: null,
      payload: { actorName: "Maya" },
      created_at: "2026-09-30T10:00:00.500Z",
      read_at: null,
    });
  });

  test("unusable records are dropped", () => {
    expect(toNotification(null)).toBeNull();
    expect(toNotification([])).toBeNull();
    expect(toNotification({ id: "x", kind: "task_assigned" })).toBeNull();
    expect(
      toNotification({ id: "", kind: "task_assigned", created_at: "2026-09-30T10:00:00Z" }),
    ).toBeNull();
    expect(toNotification({ id: "x", kind: 3, created_at: "2026-09-30T10:00:00Z" })).toBeNull();
  });

  test("a missing payload becomes an empty one", () => {
    expect(
      toNotification({ id: "x", kind: "task_assigned", created_at: "2026-09-30T10:00:00Z" })
        ?.payload,
    ).toEqual({});
  });
});
