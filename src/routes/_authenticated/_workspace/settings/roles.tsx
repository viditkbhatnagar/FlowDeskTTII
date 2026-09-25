import { createFileRoute } from "@tanstack/react-router";
import { RolesPage } from "@/components/workspace/RolesPage";
import { pageHead } from "@/routes/_authenticated/-workspace-shell";

export const Route = createFileRoute("/_authenticated/_workspace/settings/roles")({
  head: () => pageHead("settings-roles"),
  component: RolesPage,
});
