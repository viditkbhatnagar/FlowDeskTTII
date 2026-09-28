// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  AVATAR_ACCEPT,
  AVATAR_MAX_INPUT_BYTES,
  applyMatrix,
  avatarDecodeProblem,
  avatarFileKind,
  avatarFileProblem,
  avatarObjectName,
  cropMatrix,
  formatMegabytes,
  normalizeRotation,
  ownAvatarObject,
  rotatedSize,
} from "./avatar-photo";

const USER = "8b5c452b-279e-4075-92c4-2b37ebccebe7";
const OTHER = "6b9546f8-c8da-4a47-a2d8-cb1b4dd614df";
const FILE_ID = "0f8a1c9e-3b1d-4c6e-9a47-2d6e1f0b9c11";
const PREFIX = "http://127.0.0.1:54421/storage/v1/object/public/avatars/";

const close = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
};

describe("avatarFileKind", () => {
  test("JPEG, PNG and WebP open as they are", () => {
    expect(avatarFileKind({ name: "a.jpg", type: "image/jpeg" })).toBe("web");
    expect(avatarFileKind({ name: "a.png", type: "image/png" })).toBe("web");
    expect(avatarFileKind({ name: "a.webp", type: "IMAGE/WEBP" })).toBe("web");
  });

  test("HEIC is tried, by type or by extension when the browser gives no type", () => {
    expect(avatarFileKind({ name: "IMG_0001.HEIC", type: "image/heic" })).toBe("heic");
    expect(avatarFileKind({ name: "IMG_0001.HEIC", type: "" })).toBe("heic");
    expect(avatarFileKind({ name: "photo.heif", type: "application/octet-stream" })).toBe("heic");
  });

  test("anything else is refused, whatever its name says", () => {
    expect(avatarFileKind({ name: "notes.pdf", type: "application/pdf" })).toBeNull();
    expect(avatarFileKind({ name: "anim.gif", type: "image/gif" })).toBeNull();
    expect(avatarFileKind({ name: "logo.svg", type: "image/svg+xml" })).toBeNull();
    expect(avatarFileKind({ name: "fake.jpg", type: "text/plain" })).toBeNull();
    expect(avatarFileKind({ name: "README", type: "" })).toBeNull();
  });

  test("the file input offers the same types", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", ".heic"]) {
      expect(AVATAR_ACCEPT.split(",")).toContain(type);
    }
  });
});

describe("avatarFileProblem", () => {
  test("a photo up to 10 MB can be tried", () => {
    expect(
      avatarFileProblem({ name: "a.jpg", type: "image/jpeg", size: AVATAR_MAX_INPUT_BYTES }),
    ).toBeNull();
  });

  test("a larger one is refused with its size and the limit", () => {
    expect(
      avatarFileProblem({ name: "a.jpg", type: "image/jpeg", size: AVATAR_MAX_INPUT_BYTES + 1 }),
    ).toBe("That photo is 10.0 MB. Choose one under 10 MB.");
    expect(avatarFileProblem({ name: "a.png", type: "image/png", size: 13_000_000 })).toBe(
      "That photo is 12.4 MB. Choose one under 10 MB.",
    );
  });

  test("a non-image and an empty file each get their own reason", () => {
    expect(avatarFileProblem({ name: "notes.txt", type: "text/plain", size: 10 })).toBe(
      "That file isn't a photo we can use. Choose a JPEG, PNG or WebP image.",
    );
    expect(avatarFileProblem({ name: "a.png", type: "image/png", size: 0 })).toBe(
      "That file is empty. Choose another photo.",
    );
  });

  test("an unreadable HEIC says what to do about it", () => {
    expect(avatarDecodeProblem("heic")).toMatch(/can't open HEIC/);
    expect(avatarDecodeProblem("web")).toMatch(/couldn't read that image/);
  });
});

describe("formatMegabytes", () => {
  test("one decimal below 100 MB, whole numbers above", () => {
    expect(formatMegabytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatMegabytes(250 * 1024 * 1024)).toBe("250 MB");
  });
});

describe("rotation", () => {
  test("normalizes to whole degrees 0–359", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-360)).toBe(0);
  });

  test("a quarter turn swaps width and height exactly", () => {
    expect(rotatedSize(200, 100, 90)).toEqual({ width: 100, height: 200 });
    expect(rotatedSize(200, 100, -90)).toEqual({ width: 100, height: 200 });
    expect(rotatedSize(200, 100, 180)).toEqual({ width: 200, height: 100 });
  });
});

describe("cropMatrix", () => {
  test("no rotation: the crop's corners land on the output's corners", () => {
    const m = cropMatrix(
      { width: 1000, height: 800 },
      { x: 100, y: 50, width: 400, height: 400 },
      0,
    );
    close(applyMatrix(m, { x: 100, y: 50 }), { x: 0, y: 0 });
    close(applyMatrix(m, { x: 500, y: 450 }), { x: 512, y: 512 });
  });

  test("a quarter turn clockwise puts the image's top-left at the top-right", () => {
    // 200×100 turned 90° is a 100×200 box; the crop is its top square.
    const m = cropMatrix({ width: 200, height: 100 }, { x: 0, y: 0, width: 100, height: 100 }, 90);
    close(applyMatrix(m, { x: 0, y: 0 }), { x: 512, y: 0 });
    // The image's bottom-left corner is the box's top-left.
    close(applyMatrix(m, { x: 0, y: 100 }), { x: 0, y: 0 });
    // Its centre is the box's centre, one output height below the crop.
    close(applyMatrix(m, { x: 100, y: 50 }), { x: 256, y: 512 });
  });

  test("half a turn mirrors the crop through the image centre", () => {
    const m = cropMatrix({ width: 300, height: 300 }, { x: 0, y: 0, width: 150, height: 150 }, 180);
    // The image's bottom-right corner is now the top-left of the box.
    close(applyMatrix(m, { x: 300, y: 300 }), { x: 0, y: 0 });
    close(applyMatrix(m, { x: 150, y: 150 }), { x: 512, y: 512 });
  });

  test("scale follows the crop width", () => {
    const m = cropMatrix(
      { width: 2048, height: 2048 },
      { x: 0, y: 0, width: 2048, height: 2048 },
      0,
    );
    expect(m[0]).toBeCloseTo(0.25, 10);
    expect(m[3]).toBeCloseTo(0.25, 10);
  });
});

describe("object names", () => {
  test("a new photo goes in the person's folder with the right extension", () => {
    expect(avatarObjectName(USER, "image/webp", FILE_ID)).toBe(`${USER}/${FILE_ID}.webp`);
    expect(avatarObjectName(USER.toUpperCase(), "image/jpeg", FILE_ID)).toBe(
      `${USER}/${FILE_ID}.jpg`,
    );
    expect(() => avatarObjectName(USER, "image/gif", FILE_ID)).toThrow();
  });

  test("the previous photo is found only when it is this person's, in our bucket", () => {
    const name = `${USER}/${FILE_ID}.webp`;
    expect(ownAvatarObject(`${PREFIX}${name}`, USER, PREFIX)).toBe(name);
    expect(ownAvatarObject(`${PREFIX}${name}?t=1`, USER, PREFIX)).toBe(name);
    expect(ownAvatarObject(`${PREFIX}${name}`, OTHER, PREFIX)).toBeNull();
    expect(ownAvatarObject("https://example.com/me.png", USER, PREFIX)).toBeNull();
    expect(
      ownAvatarObject(
        `http://127.0.0.1:54421/storage/v1/object/public/task-attachments/${name}`,
        USER,
        PREFIX,
      ),
    ).toBeNull();
    expect(
      ownAvatarObject(`${PREFIX}${USER}/../${OTHER}/${FILE_ID}.webp`, USER, PREFIX),
    ).toBeNull();
    expect(ownAvatarObject(`${PREFIX}%E0%A4%A`, USER, PREFIX)).toBeNull();
    expect(ownAvatarObject(null, USER, PREFIX)).toBeNull();
    expect(ownAvatarObject(`${PREFIX}${name}`, USER, "")).toBeNull();
  });
});
