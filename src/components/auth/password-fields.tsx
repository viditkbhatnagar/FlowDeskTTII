import { useEffect, useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// What /welcome and /reset-password share. Both exchange a one-time token from an emailed link
// for a password the person chooses there, so both read the token and check the password the
// same way. /auth borrows PasswordInput for its sign-in field.

/** 32 random bytes, hex-encoded by the database. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const PASSWORD_MIN = 8;
/** bcrypt reads at most 72 bytes; anything longer would be silently cut. */
export const PASSWORD_MAX_BYTES = 72;

export const byteLength = (value: string) => new TextEncoder().encode(value).length;

/** The token from `#token=…`, or null when it is missing or malformed. */
export function tokenFromFragment(hash: string): string | null {
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get("token")?.trim().toLowerCase() ?? "";
  return TOKEN_PATTERN.test(raw) ? raw : null;
}

/**
 * Reads the one-time token from the fragment on mount and strips the fragment (and any query)
 * from the address bar, leaving `path`, so it is not left in the history entry, a bookmark or a
 * screenshot. undefined until read; null when there is none.
 */
export function useFragmentToken(path: string): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const strip = () => {
      if (!window.location.hash && !window.location.search) return;
      // Keep the router's own history state; only the address changes.
      window.history.replaceState(window.history.state, "", path);
    };
    const found = tokenFromFragment(window.location.hash);
    strip();
    // A second run (React StrictMode in dev) finds the fragment already gone:
    // keep the token the first run read.
    setToken((previous) => previous ?? found);

    // Another link to this page opened in the same tab changes only the fragment,
    // which does not reload the page: read it here too.
    const onHashChange = () => {
      if (!new URLSearchParams(window.location.hash.replace(/^#/, "")).has("token")) return;
      const next = tokenFromFragment(window.location.hash);
      strip();
      setToken(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [path]);
  return token;
}

export function Rule({ met, children }: { met: boolean; children: React.ReactNode }) {
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

export function PasswordInput({
  id,
  value,
  onChange,
  visible,
  onToggle,
  describedBy,
  autoComplete = "new-password",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  describedBy?: string;
  /** "current-password" on a sign-in form, so the browser offers the saved one. */
  autoComplete?: "new-password" | "current-password";
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
        autoComplete={autoComplete}
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
