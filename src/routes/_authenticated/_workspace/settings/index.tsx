import { createFileRoute, redirect } from "@tanstack/react-router";

/** /settings on its own opens the first settings page. */
export const Route = createFileRoute("/_authenticated/_workspace/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/organizations", replace: true });
  },
});
