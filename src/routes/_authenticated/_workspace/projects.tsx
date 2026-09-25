import { createFileRoute } from "@tanstack/react-router";
import { ProjectsPage } from "@/components/workspace/ProjectsPage";
import {
  pageHead,
  useWorkspaceShell,
  validateFilterSearch,
} from "@/routes/_authenticated/-workspace-shell";

export const Route = createFileRoute("/_authenticated/_workspace/projects")({
  validateSearch: validateFilterSearch,
  head: () => pageHead("projects"),
  component: ProjectsRoute,
});

function ProjectsRoute() {
  const { openNewTask } = useWorkspaceShell();
  const { filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ProjectsPage
      onNewTask={openNewTask}
      dashboardFilter={filter}
      // Replace, so Back goes to the page the filter came from, not the filtered view (FD-030).
      onClearFilter={() => void navigate({ search: {}, replace: true })}
    />
  );
}
