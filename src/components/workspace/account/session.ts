import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Sign out and revoke the session on the server, not only in this browser.
 *
 * scope "global" ends every session of this user, so an access token copied
 * before Log out is refused by the server functions from then on (FD-069).
 * supabase-js clears the local session even when the server call fails; the
 * toast says so honestly rather than pretending the revocation happened.
 */
export async function signOutEverywhere(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (error) {
    console.error("[auth] Server-side sign-out failed", error);
    toast.error(
      "You're signed out on this device, but we couldn't reach the server to end your other sessions.",
    );
  }
}

/**
 * True when this browser holds a session the auth server still accepts.
 *
 * getUser() rather than getSession(): a revoked session still sits in storage,
 * and treating it as signed in would bounce between /auth and the workspace,
 * whose guard does check with the server.
 */
export async function hasLiveSession(): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser();
  return !error && Boolean(data.user);
}
