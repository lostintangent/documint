import type { Mark } from "@/document";
import { resolveFontSize } from "./measure";

export const codeTextFont = "15px ui-monospace, SFMono-Regular, Menlo, monospace";

export type InlineTextStyle = {
  baselineShift: number;
  font: string;
  hasCustomMetrics: boolean;
};

type InlineMarkTypography = {
  affectsMetrics?: boolean;
  appliesToInlineCode?: boolean;
  baselineShiftRatio?: number;
  fontScale?: number;
  fontStyle?: "italic";
  fontWeight?: "700";
  minimumFontSize?: number;
};

const inlineMarkTypographyByMark: Record<Mark, InlineMarkTypography> = {
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
    appliesToInlineCode: false,
    baselineShiftRatio: -0.35,
    fontScale: 0.72,
    minimumFontSize: 8,
  },
};

export function resolveInlineTextStyle(
  font: string,
  marks: readonly Mark[],
  inlineCode: boolean,
): InlineTextStyle {
  const baseFont = inlineCode ? codeTextFont : font;
  const markTypography = resolveInlineMarkTypography(marks, inlineCode);
  const styledFont =
    markTypography.fontScale === 1
      ? baseFont
      : scaleFontSize(baseFont, markTypography.fontScale, markTypography.minimumFontSize);
  const parts = [markTypography.fontStyle, markTypography.fontWeight].filter(Boolean);

  const baselineShift =
    markTypography.baselineShiftRatio === 0
      ? 0
      : Math.round(resolveFontSize(font) * markTypography.baselineShiftRatio);

  return {
    baselineShift,
    font: parts.length > 0 ? `${parts.join(" ")} ${styledFont}` : styledFont,
    hasCustomMetrics: inlineTextHasCustomMetrics(marks, inlineCode),
  };
}

export function inlineTextHasCustomMetrics(marks: readonly Mark[], inlineCode: boolean) {
  return (
    inlineCode ||
    marks.some((mark) => {
      const typography = inlineMarkTypographyByMark[mark];
      return typography.affectsMetrics === true && markAppliesToInlineCode(typography, inlineCode);
    })
  );
}

function resolveInlineMarkTypography(marks: readonly Mark[], inlineCode: boolean) {
  let baselineShiftRatio = 0;
  let fontScale = 1;
  let fontStyle: InlineMarkTypography["fontStyle"];
  let fontWeight: InlineMarkTypography["fontWeight"];
  let minimumFontSize = 0;

  for (const mark of marks) {
    const typography = inlineMarkTypographyByMark[mark];

    if (!markAppliesToInlineCode(typography, inlineCode)) {
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

function markAppliesToInlineCode(typography: InlineMarkTypography, inlineCode: boolean) {
  return !inlineCode || typography.appliesToInlineCode !== false;
}

function scaleFontSize(font: string, scale: number, minimumFontSize: number) {
  return font.replace(/(\d+(?:\.\d+)?)\s*px/, (_match, size: string) => {
    const scaled = Math.max(minimumFontSize, Number.parseFloat(size) * scale);
    return `${Math.round(scaled * 10) / 10}px`;
  });
}
