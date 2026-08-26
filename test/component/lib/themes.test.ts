import { expect, test } from "bun:test";
import { darkTheme, lightTheme, resolveEditorTheme } from "@/component/lib/themes";

test("preserves explicit overrides over derived defaults", () => {
  const theme = resolveEditorTheme({
    ...lightTheme,
    background: "#101010",
    headingText: "#fbbf24",
    text: "#f5f5f5",
  });

  // paragraphText derives from text (omitted on lightTheme); headingText is
  // explicitly overridden and must win over the same derivation.
  expect(theme.paragraphText).toBe("#f5f5f5");
  expect(theme.headingText).toBe("#fbbf24");
});

test("resolves missing leaf background from global background", () => {
  const theme = resolveEditorTheme({
    ...lightTheme,
    background: "#101010",
  });

  expect(theme.leafBackground).toBe("#101010");
});

test("resolves mode-aware semantic comment defaults based on background luminance", () => {
  const lightResolved = resolveEditorTheme({
    ...lightTheme,
    background: "#ffffff",
    text: "#000000",
  });
  expect(lightResolved.commentHighlightActive).toBe("#f4d35e");
  expect(lightResolved.commentHighlightResolved).toBe("#cfe9d8");
  expect(lightResolved.commentHighlightResolvedActive).toBe("#8dc4a0");

  const darkResolved = resolveEditorTheme({
    ...darkTheme,
    background: "#000000",
    text: "#ffffff",
  });
  expect(darkResolved.commentHighlightActive).toBe("#facc15");
  expect(darkResolved.commentHighlightResolved).toBe("rgba(74, 222, 128, 0.24)");
  expect(darkResolved.commentHighlightResolvedActive).toBe("#4ade80");
});

test("classifies OKLCH backgrounds like equivalent hex colors", () => {
  expect(resolveModeAwareCommentColor("oklch(1 0 0)")).toBe(
    resolveModeAwareCommentColor("#ffffff"),
  );
  expect(resolveModeAwareCommentColor("oklch(0.145 0 0)")).toBe(
    resolveModeAwareCommentColor("#000000"),
  );
});

test("derives external change colors from semantic diff tokens", () => {
  const lightResolved = resolveEditorTheme({
    ...lightTheme,
    background: "#ffffff",
    commentHighlightActive: "#111111",
    commentHighlightResolvedActive: "#222222",
    text: "#000000",
  });
  expect(lightResolved.externalChangeAdditionBackground).toBe(
    "color-mix(in srgb, #4ade80 30%, transparent)",
  );
  expect(lightResolved.externalChangeModificationBackground).toBe(
    "color-mix(in srgb, #ea580c 36%, transparent)",
  );

  const darkResolved = resolveEditorTheme({
    ...darkTheme,
    background: "#000000",
    commentHighlightActive: "#111111",
    commentHighlightResolvedActive: "#222222",
    text: "#ffffff",
  });
  expect(darkResolved.externalChangeAdditionBackground).toBe(
    "color-mix(in srgb, #4ade80 22%, transparent)",
  );
  expect(darkResolved.externalChangeModificationBackground).toBe(
    "color-mix(in srgb, #f4d35e 34%, transparent)",
  );
});

test("resolves mode-aware codeBackground default based on background luminance", () => {
  // Light themes get a theme-tinted very-dark inverted code block; dark themes
  // get a subtle lift from background.
  const lightResolved = resolveEditorTheme({
    ...lightTheme,
    background: "#ffffff",
    text: "#1f2937",
  });
  expect(lightResolved.codeBackground).toBe("color-mix(in srgb, #1f2937 60%, #000)");

  const darkResolved = resolveEditorTheme({
    ...darkTheme,
    background: "#000000",
    text: "#ffffff",
  });
  expect(darkResolved.codeBackground).toBe("color-mix(in srgb, #ffffff 8%, #000000)");
});

test("resolves mode-aware inline code defaults based on background luminance", () => {
  const lightResolved = resolveEditorTheme({
    ...lightTheme,
    background: "#ffffff",
    text: "#1f2937",
  });
  expect(lightResolved.inlineCodeBackground).toBe("color-mix(in srgb, #1f2937 8%, transparent)");
  expect(lightResolved.inlineCodeText).toBe("#7c2d12");

  const darkResolved = resolveEditorTheme({
    ...darkTheme,
    background: "#000000",
    text: "#ffffff",
  });
  expect(darkResolved.inlineCodeBackground).toBe("rgba(251, 191, 36, 0.16)");
  expect(darkResolved.inlineCodeText).toBe("#fdba74");
});

test("mentionBackground falls back to resolved inline code background when both are omitted", () => {
  // Regression guard: the resolver must thread the *resolved* inline code
  // background into mentionBackground, not read it off the input theme — the
  // latter is undefined when a theme relies on the mode-aware default.
  const lightResolved = resolveEditorTheme({
    ...lightTheme,
    background: "#ffffff",
    text: "#1f2937",
  });
  expect(lightResolved.mentionBackground).toBe(lightResolved.inlineCodeBackground);

  const darkResolved = resolveEditorTheme({
    ...darkTheme,
    background: "#000000",
    text: "#ffffff",
  });
  expect(darkResolved.mentionBackground).toBe("rgba(251, 191, 36, 0.16)");
});

function resolveModeAwareCommentColor(background: string) {
  return resolveEditorTheme({
    accent: "#c2185b",
    background,
    muted: "#737373",
    text: "#111111",
  }).commentHighlightResolved;
}
