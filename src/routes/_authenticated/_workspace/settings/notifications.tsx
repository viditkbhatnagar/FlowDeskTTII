import { createFileRoute } from "@tanstack/react-router";
import { NotificationsSettingsPage } from "@/components/workspace/NotificationsSettingsPage";
import { pageHead } from "@/routes/_authenticated/-workspace-shell";

export const Route = createFileRoute("/_authenticated/_workspace/settings/notifications")({
  head: () => pageHead("settings-notifications"),
  component: NotificationsSettingsPage,
});
