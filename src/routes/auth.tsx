import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  FolderKanban,
  Loader2,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

export const Route = createFileRoute("/auth")({
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

type AuthStep = "sign-in" | "request" | "verify" | "password" | "success";
const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

function AuthPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<AuthStep>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

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
      await navigate({ to: count ? "/" : "/no-organization" });
    });
  };

  const sendCode = (event?: FormEvent) => {
    event?.preventDefault();
    void run(async () => {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (resetError?.status === 429) {
        setError("Please wait before requesting another verification code.");
        return;
      }
      if (resetError) {
        setError("We couldn't send a verification code right now. Please try again later.");
        return;
      }
      setOtp("");
      setCountdown(RESEND_SECONDS);
      setStep("verify");
    });
  };

  const verifyCode = (event: FormEvent) => {
    event.preventDefault();
    if (otp.length !== OTP_LENGTH) {
      setError(`Enter the ${OTP_LENGTH}-digit verification code.`);
      return;
    }
    void run(async () => {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otp,
        type: "recovery",
      });
      if (verifyError) {
        setError("That code is incorrect or has expired. Request a new code and try again.");
        return;
      }
      setStep("password");
    });
  };

  const updatePassword = (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      setError("Use at least 8 characters for your new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    void run(async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setError("Your verification has expired. Request a new code to continue.");
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setError(updateError.message || "We couldn't update your password. Please try again.");
        return;
      }
      await supabase.auth.signOut();
      setPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setOtp("");
      setStep("success");
    });
  };

  const goToSignIn = () => {
    setError(null);
    setOtp("");
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
              subtitle="Enter your registered work email to receive a verification code."
            >
              <form className="mt-8 space-y-5" onSubmit={sendCode}>
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
                <Button className="h-11 w-full" type="submit" disabled={loading || !email}>
                  {loading && <Loader2 className="animate-spin" />}
                  Send verification code
                </Button>
                <BackButton onClick={goToSignIn}>Back to sign in</BackButton>
              </form>
            </AuthFrame>
          )}

          {step === "verify" && (
            <AuthFrame
              title="Check your email"
              subtitle="If this email is eligible, a verification code has been sent."
            >
              <form className="mt-8 space-y-5" onSubmit={verifyCode}>
                <Field label="Verification code" htmlFor="recovery-code">
                  <InputOTP
                    id="recovery-code"
                    maxLength={OTP_LENGTH}
                    value={otp}
                    onChange={setOtp}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    containerClassName="w-full"
                  >
                    <InputOTPGroup className="grid w-full grid-cols-6 gap-2">
                      {Array.from({ length: OTP_LENGTH }, (_, index) => (
                        <InputOTPSlot key={index} index={index} className="h-11 w-full rounded-md border-l" />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </Field>
                <FormError message={error} />
                <Button className="h-11 w-full" type="submit" disabled={loading || otp.length !== OTP_LENGTH}>
                  {loading && <Loader2 className="animate-spin" />}
                  Verify code
                </Button>
                <div className="flex items-center justify-between gap-4 text-xs">
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto px-0 py-0 text-xs"
                    onClick={() => {
                      setError(null);
                      setStep("request");
                    }}
                  >
                    Change email
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto px-0 py-0 text-xs"
                    disabled={countdown > 0 || loading}
                    onClick={() => sendCode()}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {countdown > 0 ? `Resend in ${countdown}s` : "Resend code"}
                  </Button>
                </div>
              </form>
            </AuthFrame>
          )}

          {step === "password" && (
            <AuthFrame title="Set a new password" subtitle="Choose a secure password for your Flowdesk account.">
              <form className="mt-8 space-y-5" onSubmit={updatePassword}>
                <Field label="New password" htmlFor="new-password">
                  <PasswordInput
                    id="new-password"
                    value={newPassword}
                    onChange={setNewPassword}
                    visible={showNewPassword}
                    onToggle={() => setShowNewPassword((value) => !value)}
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Confirm new password" htmlFor="confirm-password">
                  <PasswordInput
                    id="confirm-password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    visible={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword((value) => !value)}
                    autoComplete="new-password"
                  />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Use at least 8 characters. Commonly compromised passwords are not accepted.
                </p>
                <FormError message={error} />
                <Button className="h-11 w-full" type="submit" disabled={loading || !newPassword || !confirmPassword}>
                  {loading && <Loader2 className="animate-spin" />}
                  Update password
                </Button>
              </form>
            </AuthFrame>
          )}

          {step === "success" && (
            <div className="text-center" aria-live="polite">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h1 className="mt-5 text-2xl font-semibold">Your password has been updated.</h1>
              <p className="mt-2 text-sm text-muted-foreground">Sign in again with your new password.</p>
              <Button className="mt-8 h-11 w-full" onClick={goToSignIn}>
                Back to sign in
              </Button>
            </div>
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
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-foreground/15 ring-1 ring-primary-foreground/20">
            <Sparkles className="h-4 w-4" />
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

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
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

function PasswordInput({
  id,
  value,
  onChange,
  visible,
  onToggle,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoComplete: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        required
        minLength={8}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
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