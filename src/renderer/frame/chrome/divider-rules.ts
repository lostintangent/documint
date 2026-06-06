import type { DocumentLayout, LayoutRect } from "@/editor/layout";

const dividerRuleThickness = 1;

export function resolveDividerRules(
  layout: DocumentLayout,
  startIndex: number,
  endIndex: number,
  width: number,
): LayoutRect[] {
  const rules: LayoutRect[] = [];

  for (let index = startIndex; index < endIndex; index += 1) {
    const block = layout.blocks[index]!;

    if (block.type !== "divider") {
      continue;
    }

    const left = layout.options.paddingX + block.depth * layout.options.indentWidth;
    const right = width - layout.options.paddingX;

    rules.push({
      height: dividerRuleThickness,
      left,
      top: Math.round(block.top + (block.bottom - block.top - dividerRuleThickness) / 2),
      width: right - left,
    });
  }

  return rules;
}
