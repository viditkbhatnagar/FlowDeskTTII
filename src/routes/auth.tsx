import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  FolderKanban,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PasswordInput } from "@/components/auth/password-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasLiveSession } from "@/components/workspace/account/session";
import {
  requestPasswordReset,
  type PasswordResetRequestError,
} from "@/lib/password-reset.functions";

type AuthSearch = { redirect?: string; mode?: "reset"; email?: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

/** An email address to prefill (from a "Set your password" link); anything else is dropped. */
function safeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const email = value.trim();
  return email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email) ? email : undefined;
}

/**
 * The page to return to after sign-in: a path on this site only. Anything else
 * ("https://...", "//host", "/auth" itself) is dropped, so the parameter cannot
 * be used to send someone off-site.
 */
function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  if (value.startsWith("//") || value.startsWith("/\\")) return undefined;
  if (/^\/auth(?:[/?#]|$)/.test(value)) return undefined;
  return value;
}

export const Route = createFileRoute("/auth")({
  // Rendered in the browser so the session check below runs on every visit,
  // including a reload or a typed URL; on the server there is no session to see.
  ssr: false,
  validateSearch: (search: Record<string, unknown>): AuthSearch => {
    // Every key is set, even when undefined: the router merges this over the raw
    // query string, so a key left out would keep its unvalidated value. That is
    // how ?redirect=https://… used to reach navigate() and leave the site.
    return {
      redirect: safeRedirect(search.redirect),
      // ?mode=reset&email=… (the account-access email) opens the reset flow, prefilled.
      mode: search.mode === "reset" ? "reset" : undefined,
      email: safeEmail(search.email),
    };
  },
  // Browser Back from the workspace used to land on this form with the session
  // still active (FD-039). Someone already signed in goes straight back in.
  beforeLoad: async ({ search }) => {
    if (await hasLiveSession()) throw redirect({ href: search.redirect ?? "/", replace: true });
  },
  head: () => ({
    meta: [
      { title: "Sign in — Flowdesk Operations Suite" },
      {
        name: "description",
        content: "Sign in to Flowdesk to manage work across your authorized organizations.",
      },
      { property: "og:title", content: "Sign in — Flowdesk Operations Suite" },
      {
        property: "og:description",
        content: "Sign in to Flowdesk to manage work across your authorized organizations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

/**
 * The reset flow asks for an address and says a link is on its way; the link opens
 * /reset-password. Flowdesk sends that email itself (src/lib/password-reset.functions.ts):
 * Supabase Auth's own reset email cannot be used on the hosted project.
 */
type AuthStep = "sign-in" | "request" | "sent";
const RESEND_SECONDS = 60;

// None of these says whether the address has an account. The limits behind rate_limited run
// up to an hour (5 an hour per address), hence "later" rather than a number of minutes.
const RESET_ERRORS: Record<PasswordResetRequestError | "unreachable", string> = {
  invalid_email: "Enter your full work email address, like name@company.com.",
  rate_limited:
    "Too many reset requests for now. Use the link in your newest reset email, or try again later.",
  unavailable: "We couldn't send a reset link just now. Please try again in a few minutes.",
  unreachable: "We couldn't reach Flowdesk. Check your connection and try again.",
};

function AuthPage() {
  const navigate = useNavigate();
  const sendResetLink = useServerFn(requestPasswordReset);
  const { redirect: returnTo, mode, email: linkedEmail } = Route.useSearch();
  // Nothing is sent automatically: the person still presses "Email me a reset link".
  const [step, setStep] = useState<AuthStep>(mode === "reset" ? "request" : "sign-in");
  const [email, setEmail] = useState(linkedEmail ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  /** Where the latest link went: shown on "Check your email", and where "Send it again" sends. */
  const [sentTo, setSentTo] = useState("");
  const [sentAgain, setSentAgain] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [countdown]);

  const run = async (work: () => Promise<void>) => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await work();
    } finally {
      setLoading(false);
    }
  };

  const signIn = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError || !data.user) {
        setError("We couldn't sign you in. Check your details and try again.");
        return;
      }
      const { count } = await supabase
        .from("organization_memberships")
        .select("id", { count: "exact", head: true })
        .eq("user_id", data.user.id)
        .eq("status", "active");
      // replace, so Back from the workspace does not return to this form (FD-039).
      if (count) await navigate({ href: returnTo ?? "/", replace: true });
      else await navigate({ to: "/no-organization", replace: true });
    });
  };

  const requestResetLink = (address: string, again: boolean) =>
    run(async () => {
      if (address.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(address)) {
        setError(RESET_ERRORS.invalid_email);
        return;
      }
      // Offline, or the server restarting: the call itself failed.
      const result = await sendResetLink({ data: { email: address } }).catch(() => null);
      if (!result) {
        setError(RESET_ERRORS.unreachable);
        return;
      }
      if (!result.ok) {
        setError(RESET_ERRORS[result.error]);
        return;
      }
      setSentTo(address);
      setSentAgain(again);
      setCountdown(RESEND_SECONDS);
      setStep("sent");
    });

  const sendLink = (event: FormEvent) => {
    event.preventDefault();
    void requestResetLink(email.trim(), false);
  };

  const changeEmail = () => {
    setError(null);
    setSentAgain(false);
    setStep("request");
  };

  const goToSignIn = () => {
    setError(null);
    setSentAgain(false);
    setStep("sign-in");
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-background lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
      <BrandPanel />
      <section className="flex min-h-[calc(100vh-116px)] items-center justify-center bg-background px-5 py-10 sm:px-10 lg:min-h-screen lg:px-14">
        <div className="w-full max-w-[400px]">
          {step === "sign-in" && (
            <AuthFrame title="Welcome back" subtitle="Sign in to your Flowdesk workspace.">
              <form className="mt-8 space-y-5" onSubmit={signIn} noValidate>
                <Field label="Work email" htmlFor="sign-in-email">
                  <Input
                    id="sign-in-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                    className="h-11"
                  />
                </Field>
                <Field label="Password" htmlFor="sign-in-password">
                  <PasswordInput
                    id="sign-in-password"
                    value={password}
                    onChange={setPassword}
                    visible={showPassword}
                    onToggle={() => setShowPassword((value) => !value)}
                    autoComplete="current-password"
                  />
                </Field>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto px-0 py-0 text-xs"
                    onClick={() => {
                      setError(null);
                      setStep("request");
                    }}
                  >
                    Forgot / change password?
                  </Button>
                </div>
                <FormError message={error} />
                <Button className="h-11 w-full" type="submit" disabled={loading || !email || !password}>
                  {loading && <Loader2 className="animate-spin" />}
                  Sign in
                </Button>
              </form>
              <p className="mt-6 text-center text-xs text-muted-foreground">
                Access is provided by your organization administrator.
              </p>
            </AuthFrame>
          )}

          {step === "request" && (
            <AuthFrame
              title="Reset your password"
              subtitle="Enter your work email and we'll email you a link to choose a new password."
            >
              <form className="mt-8 space-y-5" onSubmit={sendLink} noValidate>
                <Field label="Work email" htmlFor="recovery-email">
                  <Input
                    id="recovery-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                    className="h-11"
                  />
                </Field>
                <FormError message={error} />
                <Button className="h-11 w-full" type="submit" disabled={loading || !email.trim()}>
                  {loading && <Loader2 className="animate-spin" />}
                  Email me a reset link
                </Button>
                <BackButton onClick={goToSignIn}>Back to sign in</BackButton>
              </form>
            </AuthFrame>
          )}

          {step === "sent" && (
            <AuthFrame
              title="Check your email"
              subtitle={
                <>
                  If <span className="break-words font-medium text-foreground">{sentTo}</span> has a
                  Flowdesk account, a link to choose a new password is on its way.
                </>
              }
            >
              <div className="mt-8 space-y-5">
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground">
                  <li>The link works once and expires in 1 hour.</li>
                  <li>Not there in a minute or two? Check your spam or junk folder.</li>
                </ul>
                {sentAgain && (
                  <p
                    role="status"
                    className="rounded-md bg-primary/10 px-3 py-2.5 text-xs text-primary"
                  >
                    Another link is on its way. Only the newest one works, so use the latest email.
                  </p>
                )}
                <FormError message={error} />
                <div className="flex items-center justify-between gap-4 text-xs">
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto px-0 py-0 text-xs"
                    onClick={changeEmail}
                  >
                    Use a different email
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto px-0 py-0 text-xs"
                    disabled={countdown > 0 || loading}
                    onClick={() => void requestResetLink(sentTo, true)}
                  >
                    {loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {countdown > 0 ? `Send it again in ${countdown}s` : "Send it again"}
                  </Button>
                </div>
                <BackButton onClick={goToSignIn}>Back to sign in</BackButton>
              </div>
            </AuthFrame>
          )}
        </div>
      </section>
    </main>
  );
}

function BrandPanel() {
  return (
    <section className="relative overflow-hidden bg-primary px-5 py-5 text-primary-foreground sm:px-8 lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:px-14 lg:py-10">
      <div className="auth-shape auth-shape-one" aria-hidden="true" />
      <div className="auth-shape auth-shape-two" aria-hidden="true" />
      <div className="relative z-10 mx-auto w-full max-w-2xl">
        <div className="flex items-center gap-3">
          {/* A white tile: the blue symbol alone would vanish on this blue panel. */}
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-primary-foreground/20">
            <img
              src="/brand/flowdesk-symbol.png"
              alt=""
              width={24}
              height={24}
              className="h-6 w-6"
            />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Flowdesk</p>
            <p className="mt-1 text-[11px] text-primary-foreground/70">Operations Suite</p>
          </div>
        </div>

        <div className="hidden pt-16 lg:block">
          <h1 className="max-w-xl text-4xl font-semibold leading-tight xl:text-5xl">
            Multiple companies. One organized workspace.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-primary-foreground/75">
            Bring your teams, tasks and projects together. Stay clear on priorities and keep work moving across every organization.
          </p>
          <div className="mt-9 grid max-w-xl gap-5">
            <div><Benefit icon={FolderKanban} title="Organize every company" text="Dedicated spaces for each organization." /></div>
            <div><Benefit icon={Users} title="Keep teams aligned" text="Clear ownership, priorities and deadlines." /></div>
            <div><Benefit icon={CheckCircle2} title="See work moving" text="Track tasks from assignment to completion." /></div>
          </div>
        </div>
      </div>
      <TaskFlowIllustration />
    </section>
  );
}

function Benefit({ icon: Icon, title, text }: { icon: typeof Users; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-foreground/10 ring-1 ring-primary-foreground/15">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-primary-foreground/65">{text}</p>
      </div>
    </div>
  );
}

function TaskFlowIllustration() {
  return (
    <div className="relative z-10 mx-auto hidden w-full max-w-2xl pb-2 lg:block" aria-hidden="true">
      <div className="rounded-xl border border-primary-foreground/15 bg-primary-foreground/10 p-4 shadow-[var(--shadow-card)] backdrop-blur-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium">Launch workspace</p>
            <p className="mt-1 text-[10px] text-primary-foreground/60">12 of 18 tasks completed</p>
          </div>
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-primary-foreground/15">
            <div className="auth-progress h-full rounded-full bg-primary-foreground/80" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            ["To Do", "Confirm project owners"],
            ["In Progress", "Prepare launch checklist"],
            ["Completed", "Set team milestones"],
          ].map(([column, task], index) => (
            <div key={column} className="rounded-lg bg-primary-foreground/8 p-2.5 ring-1 ring-primary-foreground/10">
              <p className="text-[10px] font-medium text-primary-foreground/65">{column}</p>
              <div className={`auth-task-card auth-delay-${index + 1} mt-2 rounded-md bg-background p-3 text-foreground shadow-[var(--shadow-soft)]`}>
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium">
                  {index === 2 && <Check className="h-3 w-3 text-status-done" />}
                  {task}
                </div>
                <div className="h-1 rounded-full bg-muted">
                  <div className="auth-bar-glow h-full rounded-full bg-primary" style={{ width: `${35 + index * 30}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AuthFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      {children}
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function BackButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant="ghost" className="mx-auto flex" onClick={onClick}>
      <ArrowLeft /> {children}
    </Button>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
      {message}
    </p>
  );
}