import { expect, test } from "bun:test";
import {
  resolveEditorHostPlatform,
  resolveEditorWordBoundaryStyle,
} from "@/component/lib/platform";

test("detects Mac-like browser platforms", () => {
  expect(resolveEditorHostPlatform({ platform: "MacIntel", userAgent: "" })).toBe("mac");
  expect(resolveEditorHostPlatform({ platform: "", userAgent: "Mozilla/5.0 (iPad)" })).toBe("mac");
});

test("distinguishes Windows from other non-Mac hosts", () => {
  expect(resolveEditorHostPlatform({ platform: "Win32", userAgent: "" })).toBe("windows");
  expect(resolveEditorHostPlatform({ platform: "", userAgent: "Windows NT 10.0" })).toBe(
    "windows",
  );
  expect(resolveEditorHostPlatform({ platform: "Linux x86_64", userAgent: "" })).toBe("other");
  expect(resolveEditorHostPlatform({ platform: "CrOS x86_64", userAgent: "" })).toBe("other");
});

test("maps only Windows to token-start word boundaries", () => {
  expect(resolveEditorWordBoundaryStyle("windows")).toBe("tokenStarts");
  expect(resolveEditorWordBoundaryStyle("mac")).toBe("wordEdges");
  expect(resolveEditorWordBoundaryStyle("other")).toBe("wordEdges");
});
