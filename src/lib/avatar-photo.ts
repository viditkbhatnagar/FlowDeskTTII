/**
 * Profile photos: the rules and the arithmetic, with no browser or network.
 *
 * A photo is cropped in the browser to a 512×512 square (every avatar is shown
 * round, so the square's inscribed circle is what people see), encoded as WebP
 * (JPEG where the browser cannot encode WebP) and stored in the public
 * "avatars" bucket at "<user id>/<random uuid>.webp". profiles.avatar_url holds
 * its public URL. The upload itself lives in avatar-storage.ts.
 */

export const AVATAR_BUCKET = "avatars";

/** Width and height of the stored photo, in pixels. */
export const AVATAR_OUTPUT_SIZE = 512;

/** The largest file we open for cropping. The stored photo is far smaller. */
export const AVATAR_MAX_INPUT_BYTES = 10 * 1024 * 1024;

/** The bucket's own limit (file_size_limit in 20260928000000_profile_photos.sql). */
export const AVATAR_MAX_STORED_BYTES = 2 * 1024 * 1024;

/** WebP keeps a 512×512 photo around 30–80 KB at this quality. */
export const AVATAR_ENCODE_QUALITY = 0.9;

/** The crop dialog's zoom slider. The zoom buttons move by `buttonStep`. */
export const AVATAR_ZOOM = { min: 1, max: 3, step: 0.05, buttonStep: 0.25 } as const;

/** Types every browser can open and the bucket accepts as they are. */
const WEB_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** iPhone photos. Only Safari can open them, so they are tried and refused if unreadable. */
const HEIC_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

/** For the file input: what the picker offers. */
export const AVATAR_ACCEPT = [...WEB_TYPES, "image/heic", "image/heif", ".heic", ".heif"].join(",");

/** What the stored file may be, and the extension its object name gets. */
export const AVATAR_STORED_TYPES: Readonly<Record<string, string>> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export type AvatarFileKind = "web" | "heic";

/**
 * Whether a chosen file is a photo we can try to open. Browsers leave the type
 * empty for files they do not recognise (often HEIC on Windows and Linux), so
 * the extension decides then.
 */
export function avatarFileKind(file: { name: string; type: string }): AvatarFileKind | null {
  const type = file.type.trim().toLowerCase();
  if (WEB_TYPES.includes(type)) return "web";
  if (HEIC_TYPES.includes(type)) return "heic";
  if (type && type !== "application/octet-stream") return null;
  const name = file.name.trim().toLowerCase();
  if (/\.(jpe?g|png|webp)$/.test(name)) return "web";
  if (/\.(heic|heif)$/.test(name)) return "heic";
  return null;
}

/** "12.4 MB": one decimal, so 10.02 MB does not read as "10 MB" next to the 10 MB limit. */
export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** "10 MB", for hints and messages. */
export const AVATAR_LIMIT_LABEL = `${AVATAR_MAX_INPUT_BYTES / (1024 * 1024)} MB`;

/** Why a chosen file cannot be used, as a sentence for the person, or null when it can be tried. */
export function avatarFileProblem(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (!avatarFileKind(file)) {
    return "That file isn't a photo we can use. Choose a JPEG, PNG or WebP image.";
  }
  if (file.size === 0) return "That file is empty. Choose another photo.";
  if (file.size > AVATAR_MAX_INPUT_BYTES) {
    return `That photo is ${formatMegabytes(file.size)}. Choose one under ${AVATAR_LIMIT_LABEL}.`;
  }
  return null;
}

/** When the browser could not decode a file that passed avatarFileProblem. */
export function avatarDecodeProblem(kind: AvatarFileKind): string {
  return kind === "heic"
    ? "This browser can't open HEIC photos. Save it as a JPEG or PNG and choose it again."
    : "We couldn't read that image. It may be damaged; try another photo.";
}

/** Rotation in whole degrees, 0–359. */
export function normalizeRotation(degrees: number): number {
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** cos and sin, exact at quarter turns (Math.cos(π/2) is 6e-17, not 0). */
function cosSin(degrees: number): [number, number] {
  switch (normalizeRotation(degrees)) {
    case 0:
      return [1, 0];
    case 90:
      return [0, 1];
    case 180:
      return [-1, 0];
    case 270:
      return [0, -1];
    default: {
      const radians = (degrees * Math.PI) / 180;
      return [Math.cos(radians), Math.sin(radians)];
    }
  }
}

/** The bounding box of a width × height image rotated by `degrees`. */
export function rotatedSize(
  width: number,
  height: number,
  degrees: number,
): { width: number; height: number } {
  const [cos, sin] = cosSin(degrees);
  return {
    width: Math.abs(cos * width) + Math.abs(sin * height),
    height: Math.abs(sin * width) + Math.abs(cos * height),
  };
}

/** A crop in pixels, as react-easy-crop reports it (croppedAreaPixels). */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A canvas transform: (x, y) → (a·x + c·y + e, b·x + d·y + f), the order setTransform takes. */
export type CropMatrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

/**
 * The transform that draws the image straight into the output square.
 *
 * react-easy-crop measures the crop in the rotated image's bounding box, with
 * the image centred in it. Rotating about the image centre, moving that centre
 * to the box's centre, then taking the crop's corner to the origin and scaling
 * the crop to `size` does it in one draw, so a large photo never needs a
 * canvas of its own size (iOS refuses canvases over about 16 megapixels).
 */
export function cropMatrix(
  image: { width: number; height: number },
  area: CropArea,
  degrees: number,
  size: number = AVATAR_OUTPUT_SIZE,
): CropMatrix {
  const [cos, sin] = cosSin(degrees);
  const box = rotatedSize(image.width, image.height, degrees);
  const scale = size / area.width;
  const halfW = image.width / 2;
  const halfH = image.height / 2;
  const e = scale * (-(cos * halfW - sin * halfH) + box.width / 2 - area.x);
  const f = scale * (-(sin * halfW + cos * halfH) + box.height / 2 - area.y);
  return [scale * cos, scale * sin, -scale * sin, scale * cos, e, f];
}

/** Where a point of the image lands under the transform. */
export function applyMatrix(matrix: CropMatrix, point: { x: number; y: number }) {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const STORED_NAME = new RegExp(`^(${UUID})/${UUID}\\.(webp|jpg|png)$`);

/** "<user id>/<random uuid>.<ext>" for a new photo of this person. */
export function avatarObjectName(userId: string, contentType: string, uuid: string): string {
  const extension = AVATAR_STORED_TYPES[contentType];
  if (!extension) throw new Error(`Unsupported avatar type ${contentType}`);
  return `${userId.toLowerCase()}/${uuid.toLowerCase()}.${extension}`;
}

/**
 * The object behind an avatar URL, when it is one of this person's photos in
 * our bucket; null for anything else (an old pasted link, another bucket,
 * another person's folder), which is then never deleted.
 *
 * `publicPrefix` is the bucket's public URL with a trailing slash, e.g.
 * "https://x.supabase.co/storage/v1/object/public/avatars/".
 */
export function ownAvatarObject(
  url: string | null | undefined,
  userId: string,
  publicPrefix: string,
): string | null {
  if (!url || !publicPrefix || !url.startsWith(publicPrefix)) return null;
  let name: string;
  try {
    name = decodeURIComponent(url.slice(publicPrefix.length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const match = STORED_NAME.exec(name);
  if (!match || match[1] !== userId.toLowerCase()) return null;
  return name;
}
