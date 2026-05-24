import { expect, test } from "bun:test";
import { lightTheme, resolveEditorTheme } from "@/component/lib/themes";

test("resolves sparse theme text tokens from base text", () => {
  const theme = resolveEditorTheme({
    ...withoutOptionalTokens(lightTheme),
    background: "#101010",
    text: "#f5f5f5",
  });

  expect(theme.background).toBe("#101010");
  expect(theme.text).toBe("#f5f5f5");
  expect(theme.caret).toBe("#f5f5f5");
  expect(theme.paragraphText).toBe("#f5f5f5");
  expect(theme.headingText).toBe("#f5f5f5");
  expect(theme.blockquoteText).toBe("#f5f5f5");
  expect(theme.codeText).toBe("#f5f5f5");
  expect(theme.inlineCodeText).toBe("#f5f5f5");
  expect(theme.leafText).toBe("#f5f5f5");
  expect(theme.leafButtonText).toBe("#f5f5f5");
  expect(theme.leafSecondaryText).toBe("#f5f5f5");
  expect(theme.imagePlaceholderText).toBe("#f5f5f5");
  expect(theme.linkText).toBe("#f5f5f5");
  expect(theme.listMarkerText).toBe(theme.checkboxUncheckedStroke);
  expect(theme.dividerRule).toBe(theme.headingRule);
  expect(theme.leafShadow).toBe("");
  expect(theme.mentionBackground).toBe(theme.inlineCodeBackground);
  expect(theme.mentionText).toBe("#f5f5f5");
});

test("preserves specific text color overrides", () => {
  const theme = resolveEditorTheme({
    ...withoutTextTokens(lightTheme),
    background: "#101010",
    headingText: "#fbbf24",
    text: "#f5f5f5",
  });

  expect(theme.paragraphText).toBe("#f5f5f5");
  expect(theme.headingText).toBe("#fbbf24");
});

test("keeps bundled theme colors unchanged when resolved", () => {
  const theme = resolveEditorTheme(lightTheme);

  expect(theme.paragraphText).toBe("#1f2937");
  expect(theme.headingText).toBe("#1f2937");
  expect(theme.blockquoteText).toBe("#334155");
  expect(theme.leafText).toBe("#1f2937");
  expect(theme.leafButtonText).toBe("#1f2937");
  expect(theme.leafSecondaryText).toBe("#334155");
});

test("bundled themes omit duplicate base text colors", () => {
  expect(lightTheme.paragraphText).toBeUndefined();
  expect(lightTheme.headingText).toBeUndefined();
  expect(lightTheme.leafText).toBeUndefined();
  expect(lightTheme.leafButtonText).toBeUndefined();
});

function withoutTextTokens(theme: typeof lightTheme) {
  const {
    blockquoteText: _blockquoteText,
    caret: _caret,
    codeText: _codeText,
    headingText: _headingText,
    imagePlaceholderText: _imagePlaceholderText,
    inlineCodeText: _inlineCodeText,
    insertHighlightText: _insertHighlightText,
    leafButtonText: _leafButtonText,
    leafSecondaryText: _leafSecondaryText,
    leafText: _leafText,
    linkText: _linkText,
    paragraphText: _paragraphText,
    text: _text,
    ...themeWithoutText
  } = theme;

  return themeWithoutText;
}

function withoutOptionalTokens(theme: typeof lightTheme) {
  const {
    dividerRule: _dividerRule,
    leafShadow: _leafShadow,
    ...themeWithoutOptionalChrome
  } = withoutTextTokens(theme);

  return themeWithoutOptionalChrome;
}
