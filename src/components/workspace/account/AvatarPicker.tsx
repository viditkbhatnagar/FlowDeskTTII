import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AVATAR_ACCEPT, AVATAR_LIMIT_LABEL, type CropArea } from "@/lib/avatar-photo";
import {
  openAvatarFile,
  removeAvatarPhoto,
  renderAvatar,
  saveAvatarPhoto,
} from "@/lib/avatar-storage";
import { AvatarCropDialog } from "./AvatarCropDialog";

const DEFAULT_HINT = `JPEG, PNG or WebP, up to ${AVATAR_LIMIT_LABEL}.`;

function initialsOf(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/** The photo, or the person's initials when there is none or it will not load. */
function AvatarPreview({ url, name, busy }: { url: string | null; name: string; busy: boolean }) {
  const [broken, setBroken] = useState<string | null>(null);
  const showPhoto = Boolean(url) && broken !== url;
  return (
    <div className="relative h-16 w-16 shrink-0">
      {showPhoto ? (
        <img
          src={url ?? undefined}
          alt={`${name || "Profile"} photo`}
          onError={() => setBroken(url)}
          className="h-16 w-16 rounded-full border border-border object-cover"
        />
      ) : (
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-primary/30 bg-primary/10 text-base font-semibold text-primary"
          aria-hidden="true"
        >
          {initialsOf(name) || "?"}
        </div>
      )}
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

export interface AvatarPickerProps {
  /** Whose photo: for the initials and the image's description. */
  name: string;
  /** The photo shown now: a stored URL, or a preview of one not yet saved. */
  imageUrl: string | null;
  /**
   * Called with the cropped 512×512 photo. Resolve true once it is kept; the
   * crop dialog stays open (for another try) on false. Report failures yourself.
   */
  onPhoto: (photo: Blob) => Promise<boolean> | boolean;
  /** Take the photo away. Resolve false when that failed (and was reported). */
  onRemove: () => Promise<boolean> | boolean;
  /** The id of the visible label for the group of controls. */
  labelledBy?: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * Upload photo / Change photo and Remove photo, with a crop dialog in between.
 * The file is checked and decoded first, so an unusable one is refused with a
 * reason before anything opens.
 */
export function AvatarPicker({
  name,
  imageUrl,
  onPhoto,
  onRemove,
  labelledBy,
  hint = DEFAULT_HINT,
  disabled = false,
}: AvatarPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLButtonElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const busy = opening || saving || removing;

  // The opened file is held as an object URL: let it go once it is replaced,
  // closed, or the picker goes.
  useEffect(() => {
    if (!source) return;
    return () => URL.revokeObjectURL(source);
  }, [source]);

  const closeSource = () => setSource(null);

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared at once, so choosing the same file again still counts as a change.
    event.target.value = "";
    if (!file) return;
    setOpening(true);
    const opened = await openAvatarFile(file);
    setOpening(false);
    if (!opened.ok) {
      toast.error(opened.message);
      return;
    }
    setSource(opened.value);
  };

  const save = async (area: CropArea, rotation: number) => {
    if (!source || saving) return;
    setSaving(true);
    try {
      const photo = await renderAvatar(source, area, rotation).catch((error: unknown) => {
        console.error("[flowdesk] Could not render the cropped photo", error);
        return null;
      });
      if (!photo) {
        toast.error("That photo couldn't be prepared. Try again, or choose another photo.");
        return;
      }
      if (await onPhoto(photo)) closeSource();
    } catch (error) {
      console.error("[flowdesk] Could not save the photo", error);
      toast.error("The photo couldn't be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setRemoving(true);
    let removed = false;
    try {
      removed = await onRemove();
    } catch (error) {
      console.error("[flowdesk] Could not remove the photo", error);
      toast.error("The photo couldn't be removed. Please try again.");
    } finally {
      setRemoving(false);
    }
    // The Remove button has gone; keep the keyboard where the next action is.
    if (removed) requestAnimationFrame(() => uploadRef.current?.focus());
  };

  return (
    <div className="flex items-center gap-4" role="group" aria-labelledby={labelledBy}>
      <AvatarPreview url={imageUrl} name={name} busy={busy} />
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <Button
            ref={uploadRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy}
          >
            {opening ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <ImagePlus aria-hidden="true" />
            )}
            {imageUrl ? "Change photo" : "Upload photo"}
          </Button>
          {imageUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void remove()}
              disabled={disabled || busy}
              aria-busy={removing || undefined}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {removing ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              Remove photo
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void choose(event)}
      />
      <AvatarCropDialog
        imageUrl={source}
        saving={saving}
        onCancel={closeSource}
        onSave={(area, rotation) => void save(area, rotation)}
        onClosed={() => uploadRef.current?.focus()}
      />
    </div>
  );
}

/**
 * A picker that stores the photo straight away: for someone whose account
 * exists (Edit User, and your own Profile). `onSaved` gets the new URL, or
 * null once the photo is removed.
 */
export function SavedAvatarPicker({
  userId,
  name,
  avatarUrl,
  onSaved,
  labelledBy,
  hint,
}: {
  /** null while the session is unknown: the controls are disabled. */
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  onSaved: (url: string | null) => void;
  labelledBy?: string;
  hint?: string;
}) {
  const onPhoto = async (photo: Blob) => {
    if (!userId) return false;
    const saved = await saveAvatarPhoto({ userId, photo, previousUrl: avatarUrl });
    if (!saved.ok) {
      toast.error(saved.message);
      return false;
    }
    onSaved(saved.value);
    toast.success("Photo updated.");
    return true;
  };

  const onRemove = async () => {
    if (!userId) return false;
    const removed = await removeAvatarPhoto({ userId, previousUrl: avatarUrl });
    if (!removed.ok) {
      toast.error(removed.message);
      return false;
    }
    onSaved(null);
    toast.success("Photo removed.");
    return true;
  };

  return (
    <AvatarPicker
      name={name}
      imageUrl={avatarUrl}
      onPhoto={onPhoto}
      onRemove={onRemove}
      labelledBy={labelledBy}
      hint={hint}
      disabled={!userId}
    />
  );
}
