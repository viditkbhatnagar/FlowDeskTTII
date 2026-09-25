import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ cause, location }) => {
    // Every page now has its own URL, so this guard also runs on each move between
    // workspace pages (FD-038). The session was confirmed with the auth server on
    // the way in; after that, a session still held in this browser is enough and
    // page changes stay instant. Signing out elsewhere clears it here too.
    if (cause === "stay") {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user) return { user: data.session.user };
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      // Remember the page so a deep link still lands there after sign-in.
      throw redirect({
        to: "/auth",
        search: location.href === "/" ? {} : { redirect: location.href },
      });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
