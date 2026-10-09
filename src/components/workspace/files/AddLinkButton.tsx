import { useId, useRef, useState, type FormEvent } from "react";
import { Link2, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  defaultLinkName,
  normalizeLinkUrl,
  parseLinkInput,
  type LinkFieldErrors,
  type LinkInput,
} from "@/lib/links";

export interface AddLinkButtonProps {
  /**
   * Save the link, or queue it until the task or project exists. Resolve false
   * to keep the form open with what was typed (say why with a toast); anything
   * else closes and clears it. The link is already checked: an http(s) URL and
   * a name (the hostname when none was typed).
   */
  onAdd: (link: LinkInput) => boolean | void | Promise<boolean | void>;
  disabled?: boolean;
  /** Trigger text; "Add link" by default. */
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  align?: "start" | "center" | "end";
}

const SAVE_FAILED = "The link could not be added. Please try again.";

/**
 * "Add link" next to "Attach files": a small form for a document kept in
 * SharePoint, OneDrive or Google Drive, so people open and edit it there
 * instead of downloading and re-sharing copies (Sharon, 9 Oct 2026).
 *
 * Keyboard: the button opens the form with the cursor in Link, Enter adds,
 * Escape closes and returns focus to the button.
 */
export function AddLinkButton({
  onAdd,
  disabled,
  label = "Add link",
  variant = "outline",
  size = "sm",
  className,
  align = "end",
}: AddLinkButtonProps) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<LinkFieldErrors>({});
  const [formError, setFormError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const ids = {
    url: `${uid}-url`,
    urlError: `${uid}-url-error`,
    name: `${uid}-name`,
    nameHint: `${uid}-name-hint`,
    nameError: `${uid}-name-error`,
    hint: `${uid}-hint`,
  };

  const reset = () => {
    setUrl("");
    setName("");
    setErrors({});
    setFormError("");
    setSubmitted(false);
  };

  const changeOpen = (next: boolean) => {
    // Stay open while saving, so a failure can still be shown with the text kept.
    if (!next && saving) return;
    setOpen(next);
    if (!next) reset();
  };

  // After the first attempt, errors follow the typing instead of waiting for Enter.
  const recheck = (nextUrl: string, nextName: string) => {
    if (!submitted) return;
    const parsed = parseLinkInput({ url: nextUrl, name: nextName });
    setErrors(parsed.ok ? {} : parsed.errors);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // React events bubble through portals: keep this submit out of any form
    // the button happens to sit in.
    event.stopPropagation();
    if (saving) return;
    setSubmitted(true);
    setFormError("");
    const parsed = parseLinkInput({ url, name });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      (parsed.errors.url ? urlRef : nameRef).current?.focus();
      return;
    }
    setErrors({});
    setSaving(true);
    let added: boolean | void = false;
    try {
      added = await onAdd(parsed.link);
    } catch (error) {
      console.error("[flowdesk] add link failed", error);
      setFormError(SAVE_FAILED);
      return;
    } finally {
      setSaving(false);
    }
    if (added === false) return;
    setOpen(false);
    reset();
  };

  const typedUrl = normalizeLinkUrl(url);
  const namePlaceholder = typedUrl.ok
    ? defaultLinkName(typedUrl.url)
    : "Defaults to the site's name";

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={disabled}
          className={cn("h-7 gap-1.5 px-2 text-xs", className)}
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-80 max-w-[calc(100vw-2rem)] p-0"
        aria-label="Add a link"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          urlRef.current?.focus();
        }}
      >
        <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-3 p-4">
          <div className="space-y-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Add a link
            </p>
            <p id={ids.hint} className="text-[11px] leading-snug text-muted-foreground">
              For a document in SharePoint, OneDrive or Google Drive. It opens there, so everyone
              edits the same copy.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={ids.url} className="text-xs">
              Link
            </Label>
            <Input
              ref={urlRef}
              id={ids.url}
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setFormError("");
                recheck(event.target.value, name);
              }}
              placeholder="https://…"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              required
              aria-required="true"
              aria-invalid={errors.url ? true : undefined}
              aria-describedby={errors.url ? `${ids.urlError} ${ids.hint}` : ids.hint}
              className={cn("h-8 text-xs", errors.url && "border-destructive")}
            />
            {errors.url && (
              <p id={ids.urlError} className="text-[11px] text-destructive">
                {errors.url}
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={ids.name} className="text-xs">
              Name <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              ref={nameRef}
              id={ids.name}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setFormError("");
                recheck(url, event.target.value);
              }}
              placeholder={namePlaceholder}
              autoComplete="off"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${ids.nameError} ${ids.nameHint}` : ids.nameHint}
              className={cn("h-8 text-xs", errors.name && "border-destructive")}
            />
            <p id={ids.nameHint} className="sr-only">
              Leave empty to use the site's name.
            </p>
            {errors.name && (
              <p id={ids.nameError} className="text-[11px] text-destructive">
                {errors.name}
              </p>
            )}
          </div>

          {formError && (
            <p role="alert" className="text-[11px] text-destructive">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => changeOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {saving ? "Adding…" : "Add link"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
