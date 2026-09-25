import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EMAIL_KIND_LABELS, MANAGEMENT_KINDS, type PreferenceKind } from "@/lib/email/kinds";
import type { AppRole } from "@/lib/email/snapshot";
import {
  loadMyPreferences,
  loadMyRoles,
  saveMyPreferences,
  type NotificationPreferences,
} from "@/lib/notifications-api";

const NAME_MAX_LENGTH = 100;
const PASSWORD_MIN_LENGTH = 8;
// GoTrue hashes with bcrypt, which ignores everything past 72 bytes.
const PASSWORD_MAX_LENGTH = 72;

/** The roles that receive the management summaries (they can see every task in the organization). */
const SUMMARY_ROLES: readonly AppRole[] = ["admin", "manager", "team_lead"];
const isManagementKind = (kind: PreferenceKind) =>
  (MANAGEMENT_KINDS as readonly PreferenceKind[]).includes(kind);
/** Most personal first: the order people look for them in. */
const KIND_ORDER: readonly PreferenceKind[] = [
  "task_assigned",
  "project_invitation",
  "due_reminder",
  "overdue_alert",
  "daily_digest",
  "weekly_digest",
  "daily_management",
  "weekly_management",
];

/**
 * Profile and password, from the user menu. The menu used to offer only a name,
 * an @handle, a role and Log out, with no way to change either (FD-072).
 */
export function ProfileDialog({
  open,
  onOpenChange,
  userId,
  email,
  name,
  onNameSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  email: string;
  name: string;
  onNameSaved: (name: string) => void;
}) {
  const [draftName, setDraftName] = useState(name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  // Start from the saved values each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setDraftName(name);
    setNameError(null);
    setPassword("");
    setConfirmPassword("");
    setPasswordError(null);
  }, [open, name]);

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = draftName.trim();
    if (!trimmed) {
      setNameError("Enter your name.");
      return;
    }
    if (trimmed.length > NAME_MAX_LENGTH) {
      setNameError(`Use ${NAME_MAX_LENGTH} characters or fewer.`);
      return;
    }
    if (!userId) {
      setNameError("Your session has expired. Sign in again to update your profile.");
      return;
    }
    setNameError(null);
    setSavingName(true);
    try {
      // .select() so a write that row-level security silently filtered out
      // (zero rows updated) is reported instead of looking saved.
      const { data, error } = await supabase
        .from("profiles")
        .update({ full_name: trimmed })
        .eq("user_id", userId)
        .select("user_id");
      if (error || !data?.length) {
        if (error) console.error("[profile] Could not save display name", error);
        toast.error("Your name couldn't be saved. Please try again.");
        return;
      }
      onNameSaved(trimmed);
      toast.success("Name updated.");
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH) {
      setPasswordError(`Use at least ${PASSWORD_MIN_LENGTH} characters for your new password.`);
      return;
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      setPasswordError(`Use ${PASSWORD_MAX_LENGTH} characters or fewer.`);
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError("The passwords do not match.");
      return;
    }
    setPasswordError(null);
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        // GoTrue's messages are written for people ("New password should be
        // different from the old password."), so show them as they are.
        setPasswordError(error.message || "We couldn't update your password. Please try again.");
        return;
      }
      // A changed password should also lock out any other device still signed in.
      const { error: othersError } = await supabase.auth.signOut({ scope: "others" });
      if (othersError)
        console.error("[profile] Could not end sessions on other devices", othersError);
      setPassword("");
      setConfirmPassword("");
      toast.success(
        othersError
          ? "Password updated."
          : "Password updated. Any other devices have been signed out.",
      );
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Profile &amp; password</DialogTitle>
          <DialogDescription>
            Update how your name appears to colleagues, change your password, or choose which emails
            you get.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={saveName} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Display name</Label>
            <Input
              id="profile-name"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              maxLength={NAME_MAX_LENGTH}
              autoComplete="name"
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? "profile-name-error" : undefined}
            />
            {nameError && (
              <p id="profile-name-error" role="alert" className="text-xs text-destructive">
                {nameError}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={email} readOnly disabled />
            <p className="text-[11px] text-muted-foreground">
              Your sign-in email is managed by your administrator.
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={savingName || draftName.trim() === name}>
              {savingName && <Loader2 className="animate-spin" aria-hidden="true" />}
              Save name
            </Button>
          </div>
        </form>

        <div className="h-px bg-border" />

        <form className="space-y-3" onSubmit={savePassword} noValidate>
          <p className="text-sm font-medium">Change password</p>
          <div className="space-y-1.5">
            <Label htmlFor="profile-new-password">New password</Label>
            <Input
              id="profile-new-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              aria-invalid={Boolean(passwordError)}
              aria-describedby="profile-password-hint"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-confirm-password">Confirm new password</Label>
            <Input
              id="profile-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              aria-invalid={Boolean(passwordError)}
              aria-describedby="profile-password-hint"
            />
          </div>
          <p id="profile-password-hint" className="text-[11px] text-muted-foreground">
            Use at least {PASSWORD_MIN_LENGTH} characters.
          </p>
          {passwordError && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {passwordError}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={savingPassword || !password || !confirmPassword}
            >
              {savingPassword && <Loader2 className="animate-spin" aria-hidden="true" />}
              Update password
            </Button>
          </div>
        </form>

        <div className="h-px bg-border" />

        <EmailPreferences />
      </DialogContent>
    </Dialog>
  );
}

/**
 * One switch per email the person can opt out of. Each switch saves on its own,
 * straight away, and flips back with a toast if the save fails.
 */
function EmailPreferences() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [showSummaries, setShowSummaries] = useState(false);
  const [failed, setFailed] = useState(false);
  // A switch waits for its own save, so two quick flips cannot land out of order.
  const [saving, setSaving] = useState<ReadonlySet<PreferenceKind>>(new Set());

  const load = useCallback(() => {
    setFailed(false);
    setPrefs(null);
    void Promise.all([loadMyPreferences(), loadMyRoles()]).then(([loaded, roles]) => {
      if (!loaded) return setFailed(true);
      setPrefs(loaded);
      setShowSummaries(Boolean(roles?.some((r) => SUMMARY_ROLES.includes(r.role))));
    });
  }, []);

  // Mounted each time the dialog opens, so this reads the saved values afresh.
  useEffect(load, [load]);

  const toggle = async (kind: PreferenceKind, value: boolean) => {
    setPrefs((current) => current && { ...current, [kind]: value });
    setSaving((current) => new Set(current).add(kind));
    const saved = await saveMyPreferences({ [kind]: value });
    setSaving((current) => new Set([...current].filter((k) => k !== kind)));
    if (saved) return;
    setPrefs((current) => current && { ...current, [kind]: !value });
    toast.error("That email preference couldn't be saved. Please try again.");
  };

  const kinds = KIND_ORDER.filter((kind) => showSummaries || !isManagementKind(kind));

  return (
    <section className="space-y-3" aria-labelledby="profile-email-notifications">
      <div>
        <p id="profile-email-notifications" className="text-sm font-medium">
          Email notifications
        </p>
        <p className="text-[11px] text-muted-foreground">
          Account access and password reset emails are always sent.
        </p>
      </div>
      {failed ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span role="alert">Your email preferences couldn&rsquo;t be loaded.</span>
          <Button type="button" variant="outline" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      ) : !prefs ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading…
        </p>
      ) : (
        <ul className="space-y-3">
          {kinds.map((kind) => (
            <li key={kind} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor={`profile-email-${kind}`} className="text-xs">
                  {EMAIL_KIND_LABELS[kind].label}
                </Label>
                <p
                  id={`profile-email-${kind}-description`}
                  className="text-[11px] text-muted-foreground"
                >
                  {EMAIL_KIND_LABELS[kind].description}
                </p>
              </div>
              <Switch
                id={`profile-email-${kind}`}
                checked={prefs[kind]}
                disabled={saving.has(kind)}
                onCheckedChange={(value) => void toggle(kind, value)}
                aria-describedby={`profile-email-${kind}-description`}
                className="mt-0.5"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
