import type { DocumentLayout, LayoutRect } from "@/editor/layout";
import { findAncestorIndexedBlock, resolveBlock, type EditorState } from "@/editor/state";

export type BlockquoteRuleFrame = {
  isActive: boolean;
  rect: LayoutRect;
};

const blockquoteRuleBottomInset = 3;
const blockquoteRuleMinimumHeight = 12;
const blockquoteRuleTopBleed = 1;
const blockquoteRuleWidth = 3;
const headingRuleInsetY = 5;
const headingRuleMinimumWidth = 2;
const headingRuleThickness = 1;

export function resolveHeadingRules(
  layout: DocumentLayout,
  editorState: EditorState,
  startIndex: number,
  endIndex: number,
  width: number,
) {
  const rules = new Map<string, LayoutRect>();

  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    const block = resolveBlock(editorState.documentIndex, line.blockId);

    if (block?.type !== "heading" || (block.depth !== 1 && block.depth !== 2)) {
      continue;
    }

    const current = rules.get(block.id);
    const left = line.left + line.contentInset;
    const right = width - layout.options.paddingX;
    const next: LayoutRect = {
      height: headingRuleThickness,
      left,
      top: line.top + line.height + headingRuleInsetY,
      width: Math.max(headingRuleMinimumWidth, right - left),
    };

    rules.set(block.id, current ? mergeHeadingRuleRects(current, next) : next);
  }

  return rules;
}

function mergeHeadingRuleRects(
  current: LayoutRect,
  next: LayoutRect,
): LayoutRect {
  const bottom = Math.max(current.top + current.height, next.top + next.height);

  return {
    height: current.height,
    left: current.left,
    top: bottom - current.height,
    width: current.width,
  };
}

export function resolveBlockquoteRuleFrames(
  layout: DocumentLayout,
  editorState: EditorState,
  activeBlockId: string | null,
  startIndex: number,
  endIndex: number,
) {
  const rules = new Map<string, BlockquoteRuleFrame>();

  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    const blockquoteEntry = findAncestorIndexedBlock(
      editorState.documentIndex,
      line.blockId,
      "blockquote",
    );

    if (!blockquoteEntry) {
      continue;
    }

    const current = rules.get(blockquoteEntry.block.id);
    const top = line.top - blockquoteRuleTopBleed;
    const bottom = line.top + line.height - blockquoteRuleBottomInset;
    const next: BlockquoteRuleFrame = {
      isActive: line.blockId === activeBlockId,
      rect: {
        height: Math.max(blockquoteRuleMinimumHeight, bottom - top),
        left:
          layout.options.paddingX + (blockquoteEntry.depth + 1) * layout.options.indentWidth - 10,
        top,
        width: blockquoteRuleWidth,
      },
    };

    rules.set(
      blockquoteEntry.block.id,
      current
        ? {
            isActive: current.isActive || next.isActive,
            rect: mergeBlockquoteRuleRects(current.rect, next.rect),
          }
        : next,
    );
  }

  return rules;
}

function mergeBlockquoteRuleRects(
  current: LayoutRect,
  next: LayoutRect,
): LayoutRect {
  const top = Math.min(current.top, next.top);
  const bottom = Math.max(current.top + current.height, next.top + next.height);

  return {
    height: Math.max(blockquoteRuleMinimumHeight, bottom - top),
    left: current.left,
    top,
    width: current.width,
  };
}
