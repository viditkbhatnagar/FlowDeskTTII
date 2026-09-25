import { createFileRoute } from "@tanstack/react-router";
import { OrganizationsPage } from "@/components/workspace/OrganizationsPage";
import { pageHead } from "@/routes/_authenticated/-workspace-shell";

export const Route = createFileRoute("/_authenticated/_workspace/settings/organizations")({
  head: () => pageHead("settings-organizations"),
  component: OrganizationsPage,
});
