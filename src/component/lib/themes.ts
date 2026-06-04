import type { EditorTheme, ResolvedEditorTheme } from "@/types";

const DEFAULT_THEME_PADDING_X = 16;
const DEFAULT_THEME_PADDING_Y = 18;

// Semantic comment colors split by mode. Light mode uses solid pastels that
// read well against light surfaces; dark mode uses translucent saturated
// colors that composite naturally over dark surfaces. These are convention-
// driven defaults (yellow for active highlight, green for resolved) — themes
// that want accent-tinted comment chrome override explicitly.
const SEMANTIC_COMMENT_DEFAULTS = {
  light: {
    active: "#f4d35e",
    resolved: "#cfe9d8",
    resolvedActive: "#8dc4a0",
  },
  dark: {
    active: "#facc15",
    resolved: "rgba(74, 222, 128, 0.24)",
    resolvedActive: "#4ade80",
  },
} as const;

// Semantic inline code colors follow the "warm code highlight" convention:
// a warm-tinted background patch with warm-orange text, distinct from prose.
// Light themes derive the background from `text` at 8% alpha so the patch
// adapts to slate / orange / green theme families; dark themes hardcode an
// amber patch because near-white dark-mode text alpha'd onto dark backgrounds
// produces a flat cool haze instead of the warm pop the convention calls for.
// The text color is hardcoded warm-orange in both modes — themes whose accent
// or text family clashes (e.g. midnight's violet/pink) override explicitly.
const SEMANTIC_INLINE_CODE_DEFAULTS = {
  light: { text: "#7c2d12" },
  dark: { background: "rgba(251, 191, 36, 0.16)", text: "#fdba74" },
} as const;

export const lightTheme: EditorTheme = {
  accent: "#3b82f6",
  activeBlockBackground: "#fff1c7",
  activeBlockFlash: "rgba(245, 158, 11, 0.28)",
  background: "#fcfbf7",
  blockquoteText: "#334155",
  caret: "#111827",
  codeText: "#e2e8f0",
  commentHighlight: "#d7e3fc",
  leafShadow: "0 14px 40px rgba(15, 23, 42, 0.16)",
  muted: "#64748b",
  selectionBackground: "rgba(125, 211, 252, 0.35)",
  tableBodyBackground: "rgba(248, 250, 252, 0.98)",
  tableHeaderBackground: "rgba(226, 232, 240, 0.95)",
  text: "#1f2937",
};

export const darkTheme: EditorTheme = {
  accent: "#4d93f8",
  activeBlockBackground: "rgba(125, 211, 252, 0.12)",
  activeBlockFlash: "rgba(226, 232, 240, 0.12)",
  background: "#0b1220",
  blockquoteText: "#cbd5e1",
  caret: "#f8fafc",
  codeText: "#dbeafe",
  leafShadow: "0 18px 44px rgba(2, 6, 23, 0.42), 0 0 0 1px rgba(148, 163, 184, 0.06)",
  muted: "#64748b",
  selectionBackground: "rgba(56, 189, 248, 0.28)",
  tableHeaderBackground: "rgba(30, 41, 59, 0.96)",
  text: "#dbe4f0",
};

export function resolveEditorTheme(theme: EditorTheme): ResolvedEditorTheme {
  const { accent, background, muted, text } = theme;
  const linkText = theme.linkText ?? accent;
  const headingRule = theme.headingRule ?? `color-mix(in srgb, ${text} 20%, transparent)`;
  const leafBorder = theme.leafBorder ?? `color-mix(in srgb, ${muted} 55%, transparent)`;
  const checkboxUncheckedStroke = theme.checkboxUncheckedStroke ?? muted;
  const isLight = isLightThemeBackground(background);
  const commentDefaults = isLight
    ? SEMANTIC_COMMENT_DEFAULTS.light
    : SEMANTIC_COMMENT_DEFAULTS.dark;
  // Resolve inline code background first because mentionBackground falls back
  // to it: reading `theme.inlineCodeBackground` directly would yield undefined
  // for themes that omit it and rely on the mode-aware default.
  const inlineCodeBackground =
    theme.inlineCodeBackground ??
    (isLight
      ? `color-mix(in srgb, ${text} 8%, transparent)`
      : SEMANTIC_INLINE_CODE_DEFAULTS.dark.background);
  const inlineCodeText =
    theme.inlineCodeText ??
    (isLight ? SEMANTIC_INLINE_CODE_DEFAULTS.light.text : SEMANTIC_INLINE_CODE_DEFAULTS.dark.text);

  return {
    ...theme,
    accent,
    activeBlockBackground:
      theme.activeBlockBackground ?? `color-mix(in srgb, ${accent} 12%, transparent)`,
    activeBlockFlash:
      theme.activeBlockFlash ?? `color-mix(in srgb, ${accent} 22%, transparent)`,
    // Blockquote rules tint with accent. Dark themes need higher alpha because
    // alpha'd colors composite weaker over dark backgrounds — a 22% accent
    // would barely register on a near-black bg. The active variant bumps
    // alpha further to mark the cursor-containing blockquote.
    blockquoteRule:
      theme.blockquoteRule ??
      `color-mix(in srgb, ${accent} ${isLight ? "22" : "34"}%, transparent)`,
    blockquoteRuleActive:
      theme.blockquoteRuleActive ??
      `color-mix(in srgb, ${accent} ${isLight ? "38" : "50"}%, transparent)`,
    blockquoteText: theme.blockquoteText ?? text,
    caret: theme.caret ?? text,
    checkboxCheckedFill: theme.checkboxCheckedFill ?? accent,
    checkboxCheckmark: theme.checkboxCheckmark ?? background,
    checkboxUncheckedFill: theme.checkboxUncheckedFill ?? background,
    checkboxUncheckedStroke,
    // Code block backgrounds split by mode. Light themes use a theme-tinted
    // very-dark surface (`text 60% + black`) — this preserves the "inverted
    // dark code on light editor" convention while picking up the theme's hue
    // family (slate-900 for blue/slate themes, orange-950 for warm themes,
    // green-950 for green themes, etc.). Dark themes lift slightly from
    // background (`text 8% + background`) to create a subtle code-block
    // surface that stays in the editor's tonal family.
    codeBackground:
      theme.codeBackground ??
      (isLight
        ? `color-mix(in srgb, ${text} 60%, #000)`
        : `color-mix(in srgb, ${text} 8%, ${background})`),
    codeText: theme.codeText ?? text,
    commentHighlight: theme.commentHighlight ?? `color-mix(in srgb, ${accent} 38%, transparent)`,
    commentHighlightActive: theme.commentHighlightActive ?? commentDefaults.active,
    commentHighlightResolved: theme.commentHighlightResolved ?? commentDefaults.resolved,
    commentHighlightResolvedActive:
      theme.commentHighlightResolvedActive ?? commentDefaults.resolvedActive,
    dividerRule: theme.dividerRule ?? headingRule,
    headingRule,
    headingText: theme.headingText ?? text,
    // Image placeholder chrome — these surfaces appear briefly while images
    // load and rarely warrant per-theme tuning. The defaults form a small
    // accent-tinted surface (faint bg fill + accent border + accent-colored
    // icon) that fades the live image behind a background-colored overlay
    // while it resolves.
    imageLoadingOverlay:
      theme.imageLoadingOverlay ?? `color-mix(in srgb, ${background} 40%, transparent)`,
    imagePlaceholderIcon:
      theme.imagePlaceholderIcon ?? `color-mix(in srgb, ${accent} 42%, transparent)`,
    imagePlaceholderText:
      theme.imagePlaceholderText ?? `color-mix(in srgb, ${text} 55%, transparent)`,
    imageSurfaceBackground:
      theme.imageSurfaceBackground ?? `color-mix(in srgb, ${accent} 4%, ${background})`,
    imageSurfaceBorder:
      theme.imageSurfaceBorder ?? `color-mix(in srgb, ${accent} 25%, transparent)`,
    inlineCodeBackground,
    inlineCodeText,
    // Insert-highlight pulses fade newly-inserted text from this color to
    // transparent. Defaults to `accent` directly: it ties the pulse to the
    // theme's brand hue, and stays as a plain canvas-parseable color so
    // animations that JS-blend the value (list marker pop, etc.) can read it.
    // Themes whose accent doesn't pop enough as a pulse override explicitly.
    insertHighlightText: theme.insertHighlightText ?? accent,
    leafAccent: theme.leafAccent ?? accent,
    leafBackground: theme.leafBackground ?? background,
    leafBorder,
    leafButtonText: theme.leafButtonText ?? text,
    leafInputBackground:
      theme.leafInputBackground ?? `color-mix(in srgb, ${text} 12%, ${background})`,
    leafSecondaryText: theme.leafSecondaryText ?? `color-mix(in srgb, ${text} 60%, ${muted})`,
    leafShadow: theme.leafShadow ?? "",
    leafText: theme.leafText ?? text,
    linkText,
    listMarkerText: theme.listMarkerText ?? muted,
    mentionBackground: theme.mentionBackground ?? inlineCodeBackground,
    mentionText: theme.mentionText ?? linkText,
    paddingX: theme.paddingX ?? DEFAULT_THEME_PADDING_X,
    paddingY: theme.paddingY ?? DEFAULT_THEME_PADDING_Y,
    paragraphText: theme.paragraphText ?? text,
    selectionBackground:
      theme.selectionBackground ?? `color-mix(in srgb, ${accent} 28%, transparent)`,
    selectionHandleBackground: theme.selectionHandleBackground ?? background,
    selectionHandleBorder: theme.selectionHandleBorder ?? accent,
    tableBodyBackground:
      theme.tableBodyBackground ?? `color-mix(in srgb, ${text} 3%, ${background})`,
    tableBorder: theme.tableBorder ?? leafBorder,
    tableHeaderBackground:
      theme.tableHeaderBackground ?? `color-mix(in srgb, ${text} 12%, ${background})`,
    text,
  };
}

// Classifies a theme as light or dark by the background's perceived
// brightness, driving mode-aware semantic defaults (pastel vs alpha'd
// comments, warm-orange inline code text, dark vs slightly-lifted code
// blocks, etc.). Recognizes hex and rgb()/rgba(); any other format (CSS
// keyword, hsl(), color-mix(), ...) falls back to "dark", whose alpha'd
// defaults composite acceptably over any background if the heuristic
// misclassifies.
function isLightThemeBackground(background: string): boolean {
  const trimmed = background.trim();
  let r: number;
  let g: number;
  let b: number;

  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const value = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    r = Number.parseInt(value.slice(0, 2), 16);
    g = Number.parseInt(value.slice(2, 4), 16);
    b = Number.parseInt(value.slice(4, 6), 16);
  } else {
    const rgb = trimmed.match(/^rgba?\(([^)]+)\)$/i);
    if (!rgb) return false;
    const parts = rgb[1].split(/[,\s/]+/).map(Number.parseFloat);
    if (parts.length < 3 || !parts.slice(0, 3).every(Number.isFinite)) return false;
    r = parts[0]!;
    g = parts[1]!;
    b = parts[2]!;
  }

  // Rec. 601 luma weights; threshold at the midpoint of [0, 255].
  return r * 0.299 + g * 0.587 + b * 0.114 > 128;
}
