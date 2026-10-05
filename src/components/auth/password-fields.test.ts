// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import { PASSWORD_MAX_BYTES, byteLength, tokenFromFragment } from "./password-fields";

/** The shape the database issues: 32 random bytes as lowercase hex. */
const TOKEN = "0f8a1c9e3b1d4c6e9a472d6e1f0b9c11c5a8e2f47b3d9a60e1c4f8b2a7d3e5f9";

describe("tokenFromFragment", () => {
  test("reads the token the email puts in the fragment", () => {
    expect(TOKEN).toHaveLength(64);
    expect(tokenFromFragment(`#token=${TOKEN}`)).toBe(TOKEN);
  });

  test("works without the leading #", () => {
    expect(tokenFromFragment(`token=${TOKEN}`)).toBe(TOKEN);
  });

  test("reads it among other fragment parameters", () => {
    expect(tokenFromFragment(`#utm=mail&token=${TOKEN}&x=1`)).toBe(TOKEN);
  });

  test("lower-cases it and drops spaces a mail client may add around it", () => {
    expect(tokenFromFragment(`#token=${TOKEN.toUpperCase()}`)).toBe(TOKEN);
    expect(tokenFromFragment(`#token=%20${TOKEN}%20`)).toBe(TOKEN);
  });

  test("is null when there is no token", () => {
    expect(tokenFromFragment("")).toBeNull();
    expect(tokenFromFragment("#")).toBeNull();
    expect(tokenFromFragment("#token=")).toBeNull();
    expect(tokenFromFragment("#type=recovery&access_token=abc")).toBeNull();
  });

  test("is null for anything that is not exactly 64 hex characters", () => {
    expect(tokenFromFragment(`#token=${TOKEN.slice(1)}`)).toBeNull();
    expect(tokenFromFragment(`#token=${TOKEN}0`)).toBeNull();
    expect(tokenFromFragment(`#token=${TOKEN.slice(1)}g`)).toBeNull();
    expect(tokenFromFragment(`#token=${TOKEN.slice(0, 32)}-${TOKEN.slice(33)}`)).toBeNull();
    // A link cut where a mail client wrapped the line.
    expect(tokenFromFragment(`#token=${TOKEN.slice(0, 40)}`)).toBeNull();
  });
});

describe("byteLength", () => {
  test("counts UTF-8 bytes, which is what bcrypt's 72 limits", () => {
    expect(PASSWORD_MAX_BYTES).toBe(72);
    expect(byteLength("a".repeat(72))).toBe(72);
    expect(byteLength("é")).toBe(2);
    expect(byteLength("🔑")).toBe(4);
    expect(byteLength("é".repeat(37))).toBeGreaterThan(PASSWORD_MAX_BYTES);
  });
});
