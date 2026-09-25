import { createFileRoute } from "@tanstack/react-router";
import { TeamTasksPage } from "@/components/workspace/TeamTasksPage";
import {
  pageHead,
  useWorkspaceShell,
  validateFilterSearch,
  type FilterSearch,
} from "@/routes/_authenticated/-workspace-shell";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?task=<uuid> (links in management summaries) opens that task; anything else is ignored. */
type TeamSearch = FilterSearch & { task?: string };

function validateSearch(search: Record<string, unknown>): TeamSearch {
  const task = typeof search.task === "string" ? search.task.trim().toLowerCase() : "";
  // Every key is set, even when invalid: the router merges this over the raw query
  // string, so a key left out keeps its unvalidated value (e.g. ?filter=1, a number).
  return {
    filter: undefined,
    ...validateFilterSearch(search),
    task: UUID_PATTERN.test(task) ? task : undefined,
  };
}

export const Route = createFileRoute("/_authenticated/_workspace/team")({
  validateSearch,
  head: () => pageHead("team"),
  component: TeamTasksRoute,
});

function TeamTasksRoute() {
  const { openNewTask, goToUsers } = useWorkspaceShell();
  const { filter, task } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TeamTasksPage
      onNewTask={openNewTask}
      dashboardFilter={filter}
      // Replace, so Back goes to the page the filter came from, not the filtered view (FD-030).
      onClearFilter={() => void navigate({ search: {}, replace: true })}
      onManageMembers={goToUsers}
      linkedTaskId={task}
      onLinkedTaskClosed={() =>
        void navigate({ search: ({ task: _closed, ...rest }) => rest, replace: true })
      }
    />
  );
}
