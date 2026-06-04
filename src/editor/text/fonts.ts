import type { Mark } from "@/document";
import { resolveFontSize } from "./measure";

const MONOSPACE_STACK = "ui-monospace, SFMono-Regular, Menlo, monospace";

// Inline code (and block code) render one px smaller than the document's
// base font, the convention typesetters use to keep monospace glyphs from
// reading visually heavier than surrounding sans-serif text at the same
// nominal size.
export function resolveCodeFont(baseFontSize: number) {
  return `${Math.max(1, baseFontSize - 1)}px ${MONOSPACE_STACK}`;
}

export type InlineTextStyle = {
  baselineShift: number;
  font: string;
  hasCustomMetrics: boolean;
};

export type InlineTextTypography = {
  baseFontSize: number;
  font: string;
};

type InlineMarkTypography = {
  affectsMetrics?: boolean;
  appliesToCode?: boolean;
  baselineShiftRatio?: number;
  fontScale?: number;
  fontStyle?: "italic";
  fontWeight?: "700";
  minimumFontSize?: number;
};

const inlineMarkTypographyByMark: Record<Mark, InlineMarkTypography> = {
  code: {
    affectsMetrics: true,
  },
  bold: {
    affectsMetrics: true,
    fontWeight: "700",
  },
  italic: {
    affectsMetrics: true,
    fontStyle: "italic",
  },
  strikethrough: {},
  underline: {},
  superscript: {
    affectsMetrics: true,
    appliesToCode: false,
    baselineShiftRatio: -0.35,
    fontScale: 0.72,
    minimumFontSize: 8,
  },
};

export function resolveInlineTextStyle(
  typography: InlineTextTypography,
  marks: readonly Mark[],
): InlineTextStyle {
  const isCode = marks.includes("code");
  // Inline code uses the document-base code font even inside a heading, so
  // `<code>` callouts read as code (smaller, monospaced) rather than scaled
  // to the heading size. The block-level code font is also derived from
  // `baseFontSize` upstream, keeping inline and block code in sync.
  const baseFont = isCode ? resolveCodeFont(typography.baseFontSize) : typography.font;
  const markTypography = resolveInlineMarkTypography(marks, isCode);
  const styledFont =
    markTypography.fontScale === 1
      ? baseFont
      : scaleFontSize(baseFont, markTypography.fontScale, markTypography.minimumFontSize);
  const parts = [markTypography.fontStyle, markTypography.fontWeight].filter(Boolean);

  const baselineShift =
    markTypography.baselineShiftRatio === 0
      ? 0
      : Math.round(resolveFontSize(typography.font) * markTypography.baselineShiftRatio);

  return {
    baselineShift,
    font: parts.length > 0 ? `${parts.join(" ")} ${styledFont}` : styledFont,
    hasCustomMetrics: inlineTextHasCustomMetrics(marks),
  };
}

export function inlineTextHasCustomMetrics(marks: readonly Mark[]) {
  const isCode = marks.includes("code");
  return marks.some((mark) => {
    const typography = inlineMarkTypographyByMark[mark];
    return typography.affectsMetrics === true && markAppliesToCode(typography, isCode);
  });
}

function resolveInlineMarkTypography(marks: readonly Mark[], isCode: boolean) {
  let baselineShiftRatio = 0;
  let fontScale = 1;
  let fontStyle: InlineMarkTypography["fontStyle"];
  let fontWeight: InlineMarkTypography["fontWeight"];
  let minimumFontSize = 0;

  for (const mark of marks) {
    const typography = inlineMarkTypographyByMark[mark];

    if (!markAppliesToCode(typography, isCode)) {
      continue;
    }

    baselineShiftRatio += typography.baselineShiftRatio ?? 0;
    fontScale *= typography.fontScale ?? 1;
    fontStyle ??= typography.fontStyle;
    fontWeight ??= typography.fontWeight;
    minimumFontSize = Math.max(minimumFontSize, typography.minimumFontSize ?? 0);
  }

  return {
    baselineShiftRatio,
    fontScale,
    fontStyle,
    fontWeight,
    minimumFontSize,
  };
}

function markAppliesToCode(typography: InlineMarkTypography, isCode: boolean) {
  return !isCode || typography.appliesToCode !== false;
}

function scaleFontSize(font: string, scale: number, minimumFontSize: number) {
  return font.replace(/(\d+(?:\.\d+)?)\s*px/, (_match, size: string) => {
    const scaled = Math.max(minimumFontSize, Number.parseFloat(size) * scale);
    return `${Math.round(scaled * 10) / 10}px`;
  });
}
