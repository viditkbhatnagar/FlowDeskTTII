import { createFileRoute } from "@tanstack/react-router";
import { TaskProjectSettingsPage } from "@/components/workspace/TaskProjectSettingsPage";
import { pageHead } from "@/routes/_authenticated/-workspace-shell";

export const Route = createFileRoute("/_authenticated/_workspace/settings/tasks")({
  head: () => pageHead("settings-tasks"),
  component: TaskProjectSettingsPage,
});
