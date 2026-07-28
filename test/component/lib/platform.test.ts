import { expect, test } from "bun:test";
import { resolveEditorPlatform } from "@/component/lib/platform";

test("detects Mac-like browser platforms", () => {
  expect(resolveEditorPlatform({ platform: "MacIntel", userAgent: "" })).toBe("mac");
  expect(resolveEditorPlatform({ platform: "", userAgent: "Mozilla/5.0 (iPad)" })).toBe("mac");
});

test("treats other and missing browser platforms as non-Mac", () => {
  expect(resolveEditorPlatform({ platform: "Win32", userAgent: "" })).toBe("nonMac");
  expect(resolveEditorPlatform(null)).toBe("nonMac");
});
