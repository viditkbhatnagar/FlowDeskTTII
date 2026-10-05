import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Info, KeyRound, Link2Off, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN,
  PasswordInput,
  Rule,
  byteLength,
  useFragmentToken,
} from "@/components/auth/password-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * /reset-password#token=… — where the "Reset your password" email's button
 * lands. Someone who forgot their password asked for it on /auth;
 * request_password_reset queued the email with a one-time token, which
 * complete_password_reset exchanges here for the new password.
 *
 * Flowdesk sends this email itself, like the welcome email: the hosted
 * project's own reset email comes from Lovable's auth email hook, which we
 * cannot change, and it opened the old prototype site.
 *
 * Public on purpose (outside _authenticated): the person cannot sign in. As on
 * /welcome, the token travels in the fragment, which the browser never sends
 * to a server (so it is not in the nginx access log) nor in a Referer, and the
 * page removes it from the address bar as soon as it has read it. It is never
 * logged.
 */

export const Route = createFileRoute("/reset-password")({
  // Browser-only, like /welcome: the token lives in the fragment, which only
  // the browser can read.
  ssr: false,
  head: () => ({
    meta: [
      { title: "Choose a new password — Flowdesk" },
      { name: "description", content: "Choose a new password for your Flowdesk account." },
      // Belt and braces: the token is already out of the address by the time
      // anything else loads, but never send this page's address as a Referer.
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

type Stage = "reading" | "form" | "invalid" | "password-changed";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const token = useFragmentToken("/reset-password");
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
      const { data: email, error: resetError } = await supabase.rpc("complete_password_reset", {
        p_token: token,
        p_password: password,
      });
      if (resetError) {
        // P0001: expired, already used, replaced by a newer link, or never
        // issued. The function words them all alike; so does the page.
        if (resetError.code === "P0001" || /link|token/i.test(resetError.message ?? "")) {
          setStage("invalid");
        } else if (resetError.code === "22023" && resetError.message) {
          setError(resetError.message);
        } else {
          setError(
            "We couldn't change your password just now. Check your connection and try again.",
          );
        }
        return;
      }
      // The password has changed, so the link is spent whatever happens next.
      if (!email) {
        setStage("password-changed");
        return;
      }

      // The link belongs to this person, not to whoever was signed in here.
      if (otherAccount) await supabase.auth.signOut({ scope: "local" });
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setStage("password-changed");
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
      <ResetPanel />
      <section className="flex min-h-[calc(100vh-76px)] items-center justify-center px-5 py-10 sm:px-10 lg:min-h-screen lg:px-14">
        <div className="w-full max-w-[400px]">
          {stage === "form" && (
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">
                Password reset
              </p>
              <h1 className="mt-2 text-2xl font-semibold">Choose a new password</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                You'll use it with your work email to sign in to Flowdesk. Changing it signs you out
                on your other devices.
              </p>

              {otherAccount && (
                <div className="mt-6 flex gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <p>
                    This browser is signed in as{" "}
                    <span className="font-medium text-foreground">{otherAccount}</span>. Changing
                    the password signs that account out here.
                  </p>
                </div>
              )}

              <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
                <div className="space-y-2">
                  <Label htmlFor="reset-password">New password</Label>
                  <PasswordInput
                    id="reset-password"
                    value={password}
                    onChange={(value) => {
                      setPassword(value);
                      setError(null);
                    }}
                    visible={showPassword}
                    onToggle={() => setShowPassword((value) => !value)}
                    describedBy="reset-password-rules"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reset-confirm">Confirm new password</Label>
                  <PasswordInput
                    id="reset-confirm"
                    value={confirm}
                    onChange={(value) => {
                      setConfirm(value);
                      setError(null);
                    }}
                    visible={showConfirm}
                    onToggle={() => setShowConfirm((value) => !value)}
                  />
                </div>

                <ul id="reset-password-rules" className="space-y-1.5 text-xs" aria-live="polite">
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
                  {loading ? "Changing your password…" : "Change password and sign in"}
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
                Reset links work once and expire after 1 hour, and asking for a new one stops the
                earlier ones working. Send yourself a fresh link, or sign in if you've already
                changed your password.
              </p>
              <div className="mt-8 grid gap-3">
                <Button asChild className="h-11 w-full">
                  <Link to="/auth" search={{ mode: "reset" }}>
                    <KeyRound /> Send a new link
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11 w-full">
                  <Link to="/auth">Go to sign in</Link>
                </Button>
              </div>
            </div>
          )}

          {stage === "password-changed" && (
            <div className="text-center lg:text-left" aria-live="polite">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary lg:mx-0">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </div>
              <h1 className="mt-5 text-2xl font-semibold">Your password has been changed</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                We couldn't sign you in automatically. Sign in with your work email and your new
                password.
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

/** The auth page's blue brand panel, speaking to someone who can't get in. */
function ResetPanel() {
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
          Back to work in a minute.
        </h2>
        <p className="mt-5 max-w-md text-base leading-7 text-primary-foreground/75">
          Choose a new password and you're signed straight in, with your tasks and projects just as
          you left them.
        </p>
      </div>
      {/* Balances the logo row, so the message sits in the visual middle. */}
      <div className="hidden h-9 lg:block" aria-hidden="true" />
    </section>
  );
}
