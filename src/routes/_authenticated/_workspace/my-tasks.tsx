import { createFileRoute } from "@tanstack/react-router";
import { MyTasksPage } from "@/components/workspace/MyTasksPage";
import {
  pageHead,
  useWorkspaceShell,
  validateFilterSearch,
} from "@/routes/_authenticated/-workspace-shell";

export const Route = createFileRoute("/_authenticated/_workspace/my-tasks")({
  validateSearch: validateFilterSearch,
  head: () => pageHead("my-tasks"),
  component: MyTasksRoute,
});

function MyTasksRoute() {
  const { openNewTask } = useWorkspaceShell();
  const { filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <MyTasksPage
      onNewTask={openNewTask}
      dashboardFilter={filter}
      // Replace, so Back goes to the page the filter came from, not the filtered view (FD-030).
      onClearFilter={() => void navigate({ search: {}, replace: true })}
    />
  );
}
