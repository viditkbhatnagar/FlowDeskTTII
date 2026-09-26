import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Check, CheckCircle2, Eye, EyeOff, Info, KeyRound, Link2Off, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * /welcome#token=… — where the welcome email's "Set your password" button
 * lands. An admin created the account from Settings → Users; the token is the
 * one-time secret complete_account_setup exchanges for a password.
 *
 * Public on purpose (outside _authenticated): the person has no password yet.
 * The token travels in the fragment, which the browser never sends to a server
 * (so it is not in the nginx access log) nor in a Referer. The page reads it
 * once and removes it from the address bar straight away. It is never logged.
 */

/** 32 random bytes, hex-encoded by the database. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const PASSWORD_MIN = 8;
/** bcrypt reads at most 72 bytes; anything longer would be silently cut. */
const PASSWORD_MAX_BYTES = 72;

const byteLength = (value: string) => new TextEncoder().encode(value).length;

/** The token from `#token=…`, or null when it is missing or malformed. */
function tokenFromFragment(hash: string): string | null {
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get("token")?.trim().toLowerCase() ?? "";
  return TOKEN_PATTERN.test(raw) ? raw : null;
}

export const Route = createFileRoute("/welcome")({
  // Browser-only, like /auth: the page talks to the auth server directly, and
  // the token lives in the fragment, which only the browser can read.
  ssr: false,
  head: () => ({
    meta: [
      { title: "Choose your password — Flowdesk" },
      { name: "description", content: "Finish setting up your Flowdesk account." },
      // Belt and braces: the token is already out of the address by the time
      // anything else loads, but never send this page's address as a Referer.
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: WelcomePage,
});

type Stage = "reading" | "form" | "invalid" | "password-set";

/**
 * Reads the one-time token from the fragment on mount and strips the fragment
 * (and any query) from the address bar, so it is not left in the history entry,
 * a bookmark or a screenshot. undefined until read; null when there is none.
 */
function useFragmentToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const strip = () => {
      if (!window.location.hash && !window.location.search) return;
      // Keep the router's own history state; only the address changes.
      window.history.replaceState(window.history.state, "", "/welcome");
    };
    const found = tokenFromFragment(window.location.hash);
    strip();
    // A second run (React StrictMode in dev) finds the fragment already gone:
    // keep the token the first run read.
    setToken((previous) => previous ?? found);

    // Another welcome link opened in this same tab changes only the fragment,
    // which does not reload the page: read it here too.
    const onHashChange = () => {
      if (!new URLSearchParams(window.location.hash.replace(/^#/, "")).has("token")) return;
      const next = tokenFromFragment(window.location.hash);
      strip();
      setToken(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return token;
}

function WelcomePage() {
  const navigate = useNavigate();
  const token = useFragmentToken();
  const [stage, setStage] = useState<Stage>("reading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Someone already signed in on this browser; they are signed out on success. */
  const [otherAccount, setOtherAccount] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setOtherAccount(data.session?.user.email ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (token !== undefined) setStage(token ? "form" : "invalid");
  }, [token]);

  const longEnough = password.length >= PASSWORD_MIN;
  const shortEnough = byteLength(password) <= PASSWORD_MAX_BYTES;
  const matches = confirm.length > 0 && password === confirm;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading || !token) return;
    if (!longEnough) return setError(`Use at least ${PASSWORD_MIN} characters.`);
    if (!shortEnough) return setError("That password is too long. Keep it to 72 characters.");
    if (password !== confirm) return setError("The passwords don't match.");

    setLoading(true);
    setError(null);
    try {
      const { data: email, error: setupError } = await supabase.rpc("complete_account_setup", {
        p_token: token,
        p_password: password,
      });
      if (setupError || !email) {
        // P0001: expired, already used, or never issued. The function says
        // which rule failed only in the message; the page treats them alike.
        if (setupError?.code === "P0001" || /link|token/i.test(setupError?.message ?? "")) {
          setStage("invalid");
        } else if (setupError?.code === "22023" && setupError.message) {
          setError(setupError.message);
        } else {
          setError("We couldn't set your password just now. Check your connection and try again.");
        }
        return;
      }

      // The link belongs to this person, not to whoever was signed in here.
      if (otherAccount) await supabase.auth.signOut({ scope: "local" });
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setStage("password-set");
        return;
      }
      // replace: Back must not return to a link that no longer works.
      await navigate({ to: "/", replace: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-background lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(440px,1fr)]">
      <WelcomePanel />
      <section className="flex min-h-[calc(100vh-76px)] items-center justify-center px-5 py-10 sm:px-10 lg:min-h-screen lg:px-14">
        <div className="w-full max-w-[400px]">
          {stage === "form" && (
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">
                Account setup
              </p>
              <h1 className="mt-2 text-2xl font-semibold">Choose your password</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                You'll use it with your work email to sign in to Flowdesk.
              </p>

              {otherAccount && (
                <div className="mt-6 flex gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <p>
                    This browser is signed in as{" "}
                    <span className="font-medium text-foreground">{otherAccount}</span>. Setting
                    this password signs that account out here.
                  </p>
                </div>
              )}

              <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
                <div className="space-y-2">
                  <Label htmlFor="welcome-password">New password</Label>
                  <PasswordInput
                    id="welcome-password"
                    value={password}
                    onChange={(value) => {
                      setPassword(value);
                      setError(null);
                    }}
                    visible={showPassword}
                    onToggle={() => setShowPassword((value) => !value)}
                    describedBy="welcome-password-rules"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="welcome-confirm">Confirm password</Label>
                  <PasswordInput
                    id="welcome-confirm"
                    value={confirm}
                    onChange={(value) => {
                      setConfirm(value);
                      setError(null);
                    }}
                    visible={showConfirm}
                    onToggle={() => setShowConfirm((value) => !value)}
                  />
                </div>

                <ul id="welcome-password-rules" className="space-y-1.5 text-xs" aria-live="polite">
                  <Rule met={longEnough && shortEnough}>
                    {shortEnough
                      ? `At least ${PASSWORD_MIN} characters`
                      : "No more than 72 characters"}
                  </Rule>
                  <Rule met={matches}>Both passwords match</Rule>
                </ul>

                {error && (
                  <p
                    role="alert"
                    className="rounded-md bg-destructive/10 px-3 py-2.5 text-xs text-destructive"
                  >
                    {error}
                  </p>
                )}

                <Button
                  className="h-11 w-full"
                  type="submit"
                  disabled={loading || !password || !confirm}
                >
                  {loading && <Loader2 className="animate-spin" />}
                  {loading ? "Setting up your account…" : "Set password and sign in"}
                </Button>
              </form>
            </div>
          )}

          {stage === "invalid" && (
            <div className="text-center lg:text-left" aria-live="polite">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive lg:mx-0">
                <Link2Off className="h-6 w-6" aria-hidden="true" />
              </div>
              <h1 className="mt-5 text-2xl font-semibold">
                This link has expired or was already used
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Welcome links work once and expire after 7 days. If you've already chosen a
                password, sign in. Otherwise reset it with your work email, or ask your
                administrator to resend the welcome email.
              </p>
              <div className="mt-8 grid gap-3">
                <Button asChild className="h-11 w-full">
                  <Link to="/auth" search={{ mode: "reset" }}>
                    <KeyRound /> Reset your password
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11 w-full">
                  <Link to="/auth">Go to sign in</Link>
                </Button>
              </div>
            </div>
          )}

          {stage === "password-set" && (
            <div className="text-center lg:text-left" aria-live="polite">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary lg:mx-0">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </div>
              <h1 className="mt-5 text-2xl font-semibold">Your password is set</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                We couldn't sign you in automatically. Sign in with your work email and the password
                you just chose.
              </p>
              <Button asChild className="mt-8 h-11 w-full">
                <Link to="/auth">Go to sign in</Link>
              </Button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

/** The auth page's blue brand panel, speaking to someone who is new here. */
function WelcomePanel() {
  return (
    <section className="relative overflow-hidden bg-primary px-5 py-5 text-primary-foreground sm:px-8 lg:flex lg:min-h-screen lg:flex-col lg:px-14 lg:py-10">
      <div className="auth-shape auth-shape-one" aria-hidden="true" />
      <div className="auth-shape auth-shape-two" aria-hidden="true" />
      <div className="relative z-10 mx-auto flex w-full max-w-xl items-center gap-3">
        {/* A white tile: the blue symbol alone would vanish on this blue panel. */}
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-primary-foreground/20">
          <img src="/brand/flowdesk-symbol.png" alt="" width={24} height={24} className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-none">Flowdesk</p>
          <p className="mt-1 text-[11px] text-primary-foreground/70">Operations Suite</p>
        </div>
      </div>

      <div className="relative z-10 mx-auto hidden w-full max-w-xl flex-1 flex-col justify-center py-12 lg:flex">
        <h2 className="max-w-lg text-4xl font-semibold leading-tight xl:text-5xl">
          Welcome to Flowdesk.
        </h2>
        <p className="mt-5 max-w-md text-base leading-7 text-primary-foreground/75">
          Your administrator has set up your account. One step and you're in.
        </p>
        <ol className="mt-10 max-w-md space-y-5">
          <Step index={1} title="Choose your password" text="Right here, once." current />
          <Step index={2} title="You're signed in" text="Straight into your workspace." />
          <Step index={3} title="Pick up your work" text="Tasks and projects assigned to you." />
        </ol>
      </div>
      {/* Balances the logo row, so the welcome sits in the visual middle. */}
      <div className="hidden h-9 lg:block" aria-hidden="true" />
    </section>
  );
}

function Step({
  index,
  title,
  text,
  current = false,
}: {
  index: number;
  title: string;
  text: string;
  current?: boolean;
}) {
  return (
    <li className="flex items-start gap-3.5" aria-current={current ? "step" : undefined}>
      <span
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1",
          current
            ? "bg-primary-foreground text-primary ring-primary-foreground"
            : "bg-primary-foreground/10 text-primary-foreground ring-primary-foreground/20",
        )}
      >
        {index}
      </span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-primary-foreground/65">{text}</span>
      </span>
    </li>
  );
}

function Rule({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 transition-colors",
        met ? "text-primary" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
          met ? "border-primary bg-primary text-primary-foreground" : "border-border",
        )}
        aria-hidden="true"
      >
        {met && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      </span>
      <span>
        {children}
        <span className="sr-only">{met ? " (done)" : " (not yet)"}</span>
      </span>
    </li>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  visible,
  onToggle,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  describedBy?: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        required
        minLength={PASSWORD_MIN}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="new-password"
        aria-describedby={describedBy}
        className="h-11 pr-11"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onToggle}
        className="absolute right-1 top-1 h-9 w-9 text-muted-foreground"
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}
