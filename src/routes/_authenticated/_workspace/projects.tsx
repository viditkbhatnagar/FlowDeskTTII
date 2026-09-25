import { createFileRoute } from "@tanstack/react-router";
import { ProjectsPage } from "@/components/workspace/ProjectsPage";
import {
  pageHead,
  useWorkspaceShell,
  validateFilterSearch,
  type FilterSearch,
} from "@/routes/_authenticated/-workspace-shell";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?project=<uuid> (links in emails) opens that project; anything that is not a uuid is ignored. */
type ProjectsSearch = FilterSearch & { project?: string };

function validateSearch(search: Record<string, unknown>): ProjectsSearch {
  const project = typeof search.project === "string" ? search.project.trim().toLowerCase() : "";
  // Every key is set, even when invalid: the router merges this over the raw query
  // string, so a key left out keeps its unvalidated value (e.g. ?filter=1, a number).
  return {
    filter: undefined,
    ...validateFilterSearch(search),
    project: UUID_PATTERN.test(project) ? project : undefined,
  };
}

export const Route = createFileRoute("/_authenticated/_workspace/projects")({
  validateSearch,
  head: () => pageHead("projects"),
  component: ProjectsRoute,
});

function ProjectsRoute() {
  const { openNewTask } = useWorkspaceShell();
  const { filter, project } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ProjectsPage
      onNewTask={openNewTask}
      dashboardFilter={filter}
      // Replace, so Back goes to the page the filter came from, not the filtered view (FD-030).
      onClearFilter={() => void navigate({ search: {}, replace: true })}
      linkedProjectId={project}
      onLinkedProjectClosed={() =>
        void navigate({ search: ({ project: _closed, ...rest }) => rest, replace: true })
      }
    />
  );
}
