/**
 * Profile photos in the browser: opening a chosen file, rendering the crop and
 * storing it in the "avatars" bucket. The rules and arithmetic are in
 * avatar-photo.ts.
 *
 * Saving is: upload a new object (a fresh name every time, so no cache ever
 * shows the old photo), point profiles.avatar_url at its public URL, then
 * delete the previous object. The profile is only changed once the upload has
 * succeeded, and a photo whose profile update failed is deleted again, so a
 * failure part-way leaves the person with the photo they had.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  AVATAR_BUCKET,
  AVATAR_ENCODE_QUALITY,
  AVATAR_MAX_STORED_BYTES,
  AVATAR_OUTPUT_SIZE,
  AVATAR_STORED_TYPES,
  avatarDecodeProblem,
  avatarFileKind,
  avatarFileProblem,
  avatarObjectName,
  cropMatrix,
  ownAvatarObject,
  type CropArea,
} from "@/lib/avatar-photo";

export type AvatarResult<T> = { ok: true; value: T } | { ok: false; message: string };

function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  return image.decode().then(() => image);
}

/**
 * Check a chosen file and decode it. Decoding here, before the crop dialog
 * opens, is what tells a HEIC photo this browser cannot read from one it can.
 * Resolves with an object URL for the crop dialog; revoke it once closed.
 */
export async function openAvatarFile(file: File): Promise<AvatarResult<string>> {
  const problem = avatarFileProblem(file);
  if (problem) return { ok: false, message: problem };
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("no pixels");
    return { ok: true, value: url };
  } catch (error) {
    URL.revokeObjectURL(url);
    console.warn("[flowdesk] Could not decode the chosen photo", error);
    return { ok: false, message: avatarDecodeProblem(avatarFileKind(file) ?? "web") };
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, AVATAR_ENCODE_QUALITY));
}

/**
 * Draw the crop at 512×512 and encode it: WebP, or JPEG where the browser
 * cannot encode WebP (toBlob then quietly hands back a PNG instead).
 */
export async function renderAvatar(
  imageUrl: string,
  area: CropArea,
  rotation: number,
): Promise<Blob> {
  const image = await loadImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is not available");
  const matrix = cropMatrix(
    { width: image.naturalWidth, height: image.naturalHeight },
    area,
    rotation,
  );
  const draw = (background: string | null) => {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.setTransform(...matrix);
    context.drawImage(image, 0, 0);
  };

  draw(null);
  const webp = await canvasBlob(canvas, "image/webp");
  if (webp?.type === "image/webp") return webp;
  // JPEG has no transparency: white behind a transparent PNG, not black.
  draw("#ffffff");
  const jpeg = await canvasBlob(canvas, "image/jpeg");
  if (!jpeg) throw new Error("The browser could not encode the photo");
  return jpeg;
}

/** The bucket's public URL, with a trailing slash. */
function publicPrefix(): string {
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl("x");
  return data.publicUrl.slice(0, -1);
}

/** A storage refusal, as a sentence for the person. */
function uploadProblem(error: unknown): string {
  const { statusCode, status, message } = (error ?? {}) as {
    statusCode?: unknown;
    status?: unknown;
    message?: unknown;
  };
  const code = String(statusCode ?? status ?? "");
  const text = String(message ?? "").toLowerCase();
  if (code === "403" || text.includes("row-level security") || text.includes("unauthorized")) {
    return "You don't have permission to change this photo.";
  }
  if (code === "413" || text.includes("maximum allowed size")) {
    return "That photo is too large to store. Try again, or choose a smaller photo.";
  }
  if (code === "415" || text.includes("mime type")) {
    return "That image type can't be stored. Choose a JPEG, PNG or WebP photo.";
  }
  if (text.includes("bucket not found")) {
    return "Photo storage isn't set up yet. Ask your administrator.";
  }
  return "The photo couldn't be uploaded. Check your connection and try again.";
}

/**
 * Point the profile at a photo, or at none. .select() so an update that
 * row-level security silently filtered out (zero rows) is reported, not
 * mistaken for a save.
 */
async function setAvatarUrl(userId: string, url: string | null): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ avatar_url: url })
    .eq("user_id", userId)
    .select("user_id");
  if (error || !data?.length) {
    console.error("[flowdesk] Could not save profiles.avatar_url", error ?? "no row updated");
    return false;
  }
  return true;
}

/**
 * Delete the photo the profile pointed at before, when it is one of this
 * person's photos in our bucket. Best effort: a leftover file costs a few
 * kilobytes and is never shown, so failing here is not the person's problem.
 */
async function removeObjectBehind(userId: string, url: string | null | undefined): Promise<void> {
  const name = ownAvatarObject(url, userId, publicPrefix());
  if (!name) return;
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).remove([name]);
  if (error || !data?.length) {
    console.error("[flowdesk] Could not delete the previous profile photo", name, error);
  }
}

/** Store a cropped photo as this person's profile photo. Resolves with its public URL. */
export async function saveAvatarPhoto(input: {
  userId: string;
  photo: Blob;
  previousUrl?: string | null;
}): Promise<AvatarResult<string>> {
  const { userId, photo, previousUrl } = input;
  if (!AVATAR_STORED_TYPES[photo.type]) {
    return {
      ok: false,
      message: "That image type can't be stored. Choose a JPEG, PNG or WebP photo.",
    };
  }
  if (photo.size > AVATAR_MAX_STORED_BYTES) {
    return {
      ok: false,
      message: "That photo is too large to store. Try again, or choose a smaller photo.",
    };
  }
  const name = avatarObjectName(userId, photo.type, crypto.randomUUID());
  const bucket = supabase.storage.from(AVATAR_BUCKET);
  const { error: uploadError } = await bucket.upload(name, photo, {
    contentType: photo.type,
    // Every photo gets a new name, so it never changes and can be cached for good.
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) {
    console.error("[flowdesk] Profile photo upload failed", uploadError);
    return { ok: false, message: uploadProblem(uploadError) };
  }
  const url = bucket.getPublicUrl(name).data.publicUrl;
  if (!(await setAvatarUrl(userId, url))) {
    const { error: cleanupError } = await bucket.remove([name]);
    if (cleanupError)
      console.error("[flowdesk] Could not delete the unused photo", name, cleanupError);
    return {
      ok: false,
      message:
        "The photo was uploaded but couldn't be added to the profile. You may not have permission, or the connection dropped.",
    };
  }
  await removeObjectBehind(userId, previousUrl);
  return { ok: true, value: url };
}

/** Take the photo off the profile and delete it. */
export async function removeAvatarPhoto(input: {
  userId: string;
  previousUrl?: string | null;
}): Promise<AvatarResult<null>> {
  if (!(await setAvatarUrl(input.userId, null))) {
    return {
      ok: false,
      message:
        "The photo couldn't be removed. You may not have permission, or the connection dropped.",
    };
  }
  await removeObjectBehind(input.userId, input.previousUrl);
  return { ok: true, value: null };
}
