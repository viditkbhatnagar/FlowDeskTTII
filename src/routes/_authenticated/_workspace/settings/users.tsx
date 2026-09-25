import { createFileRoute } from "@tanstack/react-router";
import { UsersPage } from "@/components/workspace/UsersPage";
import { pageHead } from "@/routes/_authenticated/-workspace-shell";

export const Route = createFileRoute("/_authenticated/_workspace/settings/users")({
  head: () => pageHead("settings-users"),
  component: UsersPage,
});
