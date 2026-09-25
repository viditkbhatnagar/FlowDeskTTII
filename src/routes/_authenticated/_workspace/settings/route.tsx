import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAdmin } from "@/routes/_authenticated/-workspace-shell";

/**
 * Settings are for admins only. The sidebar has always hidden them from everyone
 * else; now that each has its own URL (FD-038) a typed or shared link is checked too.
 */
export const Route = createFileRoute("/_authenticated/_workspace/settings")({
  beforeLoad: async ({ context, cause }) => {
    if (cause === "stay") return;
    await requireAdmin(context.user.id);
  },
  component: () => <Outlet />,
});
