import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, LogOut, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutEverywhere } from "@/components/workspace/account/session";

export const Route = createFileRoute("/_authenticated/no-organization")({
  head: () => ({
    meta: [
      { title: "Organization access required — Flowdesk" },
      { name: "description", content: "Your Flowdesk account needs organization access." },
      { property: "og:title", content: "Organization access required — Flowdesk" },
      { property: "og:description", content: "Your Flowdesk account needs organization access." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NoOrganizationPage,
});

function NoOrganizationPage() {
  const navigate = useNavigate();
  const signOut = async () => {
    // Revoked on the server as well, like Log out in the workspace (FD-069).
    await signOutEverywhere();
    await navigate({ to: "/auth", replace: true });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-5">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[var(--shadow-soft)]">
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="mx-auto mt-8 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Building2 className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold">Organization access required</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your account is active, but it has not been assigned to an organization. Contact your organization administrator for access.
        </p>
        <Button variant="outline" className="mt-8" onClick={signOut}>
          <LogOut aria-hidden="true" /> Sign out
        </Button>
      </div>
    </main>
  );
}