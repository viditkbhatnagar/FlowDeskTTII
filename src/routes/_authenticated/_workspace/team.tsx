import { createFileRoute } from "@tanstack/react-router";
import { TeamTasksPage } from "@/components/workspace/TeamTasksPage";
import {
  pageHead,
  useWorkspaceShell,
  validateFilterSearch,
} from "@/routes/_authenticated/-workspace-shell";

export const Route = createFileRoute("/_authenticated/_workspace/team")({
  validateSearch: validateFilterSearch,
  head: () => pageHead("team"),
  component: TeamTasksRoute,
});

function TeamTasksRoute() {
  const { openNewTask, goToUsers } = useWorkspaceShell();
  const { filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TeamTasksPage
      onNewTask={openNewTask}
      dashboardFilter={filter}
      // Replace, so Back goes to the page the filter came from, not the filtered view (FD-030).
      onClearFilter={() => void navigate({ search: {}, replace: true })}
      onManageMembers={goToUsers}
    />
  );
}
