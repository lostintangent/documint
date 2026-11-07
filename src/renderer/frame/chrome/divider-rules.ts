import { resolveBlockSurfaceLeft, type DocumentLayout, type LayoutRect } from "@/editor/layout";
import type { EditorState } from "@/editor/state";

const dividerRuleThickness = 1;

export function resolveDividerRules(
  layout: DocumentLayout,
  editorState: EditorState,
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

    const left = resolveBlockSurfaceLeft(
      editorState.documentIndex,
      { depth: block.depth, path: block.blockPath },
      layout.options,
    );
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
