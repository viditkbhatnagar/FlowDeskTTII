import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/components/workspace/DashboardPage";
import { pageHead, useWorkspaceShell } from "@/routes/_authenticated/-workspace-shell";

export const Route = createFileRoute("/_authenticated/_workspace/")({
  head: () => pageHead("dashboard"),
  component: DashboardRoute,
});

function DashboardRoute() {
  const { goTo } = useWorkspaceShell();
  // A card or row opens its page with the filter in the URL, e.g. /team?filter=overdue.
  return <DashboardPage onNavigate={goTo} />;
}
