// Owns block-level rules: heading underlines, blockquote bars, and dividers.

import type { LayoutRect } from "@/editor/layout";
import type { ResolvedEditorTheme } from "../../theme";
import type { BlockquoteRuleFrame } from "@/renderer/frame/chrome/rules";

export function paintRules(
  context: CanvasRenderingContext2D,
  color: string,
  rules: Iterable<LayoutRect>,
) {
  for (const rule of rules) {
    context.fillStyle = color;
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
