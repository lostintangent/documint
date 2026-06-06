import type { LayoutRect } from "@/editor/layout";
import type { ResolvedEditorTheme } from "@/types";
import type { BlockquoteRuleFrame } from "@/renderer/frame/chrome/rules";

// Horizontal rules (heading underline, divider). Both terminate at the same
// right edge (`width - paddingX`) so they line up visually; their per-rule
// constants stay separate so they can drift if a designer wants distinct
// weights or insets later.

export function paintInertBlock(
  context: CanvasRenderingContext2D,
  dividerRules: readonly LayoutRect[],
  theme: ResolvedEditorTheme,
) {
  for (const rule of dividerRules) {
    context.fillStyle = theme.dividerRule;
    context.fillRect(rule.left, rule.top, rule.width, rule.height);
  }
}

export function paintHeadingRules(
  context: CanvasRenderingContext2D,
  headingRules: ReadonlyMap<string, LayoutRect>,
  theme: ResolvedEditorTheme,
) {
  for (const rule of headingRules.values()) {
    context.fillStyle = theme.headingRule;
    context.fillRect(rule.left, rule.top, rule.width, rule.height);
  }
}

export function paintBlockquoteRules(
  context: CanvasRenderingContext2D,
  blockquoteRules: ReadonlyMap<string, BlockquoteRuleFrame>,
  theme: ResolvedEditorTheme,
) {
  for (const rule of blockquoteRules.values()) {
    context.fillStyle = rule.isActive ? theme.blockquoteRuleActive : theme.blockquoteRule;
    context.fillRect(rule.rect.left, rule.rect.top, rule.rect.width, rule.rect.height);
  }
}
