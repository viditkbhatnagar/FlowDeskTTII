import { useState } from "react";
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { Building2, Loader2, LogOut, RefreshCw, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutEverywhere } from "@/components/workspace/account/session";
import { loadAccountAccess } from "@/routes/_authenticated/-workspace-shell";

type Blocked = "deactivated" | "no-organization";

const COPY: Record<Blocked, { title: string; body: string }> = {
  deactivated: {
    title: "Your Flowdesk account is deactivated",
    body: "An administrator has switched off your access, so you can't open any workspace. If you think this is a mistake, ask your organization's administrator to activate your account again.",
  },
  "no-organization": {
    title: "You haven't been added to an organization yet",
    body: "Your account is ready, but nobody has given you access to an organization. Ask your organization's administrator to add you, then check again.",
  },
};

/**
 * Where the workspace sends someone who can't use it, with the reason. The
 * address is kept from before (bookmarks, the workspace guard); the page works
 * out the reason itself, so it never says "not added" to someone deactivated,
 * and sends anyone whose access is back to the workspace.
 */
export const Route = createFileRoute("/_authenticated/no-organization")({
  loader: async ({ context }): Promise<{ access: Blocked }> => {
    const access = await loadAccountAccess(context.user.id);
    if (access === "ok") throw redirect({ to: "/", replace: true });
    return { access };
  },
  head: ({ loaderData }) => {
    const { title, body } = COPY[loaderData?.access ?? "no-organization"];
    return {
      meta: [
        { title: `${title} — Flowdesk` },
        { name: "description", content: body },
        { property: "og:title", content: `${title} — Flowdesk` },
        { property: "og:description", content: body },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: NoAccessPage,
});

function NoAccessPage() {
  const { access } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const { title, body } = COPY[access];
  const Icon = access === "deactivated" ? UserX : Building2;

  const signOut = async () => {
    // Revoked on the server as well, like Log out in the workspace (FD-069).
    await signOutEverywhere();
    await navigate({ to: "/auth", replace: true });
  };

  // Runs the loader again: it opens the workspace once access has been given.
  const checkAgain = async () => {
    setChecking(true);
    try {
      await router.invalidate();
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-5">
      <div className="w-full max-w-md text-center">
        {/* The same symbol as the sign-in page and the sidebar. */}
        <img
          src="/brand/flowdesk-symbol.png"
          alt="Flowdesk"
          width={44}
          height={44}
          className="mx-auto h-11 w-11"
        />
        <div
          className={
            access === "deactivated"
              ? "mx-auto mt-8 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
              : "mx-auto mt-8 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"
          }
        >
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-balance">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {access === "no-organization" && (
            <Button
              onClick={() => void checkAgain()}
              disabled={checking}
              aria-busy={checking || undefined}
            >
              {checking ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              Check again
            </Button>
          )}
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut aria-hidden="true" /> Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
