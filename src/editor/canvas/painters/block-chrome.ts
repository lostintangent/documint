// Owns block-level chrome: the backgrounds and rules that sit behind a block
// rather than inside its inline content. These split into three call shapes —
// per-line painters that the foreground/background passes invoke, per-block
// painters for inert blocks (divider; future image-as-block, embed) that
// have no lines of their own, and per-document-block accumulators that the
// orchestrator collects across the visible range and then paints once.

import type { Block } from "@/document";
import {
  findBlockAncestor,
  resolveLineContentInset,
  type DocumentLayout,
} from "../../layout";
import type { EditorState } from "../../state";
import type { EditorTheme } from "@/types";
import { resolveActiveBlockFlashColor, type ActiveBlockFlash } from "../lib/animations";
import { paintTableCellChrome, type PaintRegionBounds } from "./table";

export const activeLineVerticalBleed = 2;

const blockquoteRuleInsetY = 3;
const blockquoteRuleMinimumHeight = 12;
const blockquoteRuleTrimY = 6;
const blockquoteRuleWidth = 3;

const codeBlockBackgroundBottomInset = 8;
const codeBlockBackgroundHorizontalInset = 12;
const codeBlockBackgroundMinimumWidthBoost = 28;
const codeBlockBackgroundTopInset = 4;

// Horizontal rules (heading underline, divider). Both terminate at the same
// right edge (`width - paddingX`) so they line up visually; their per-rule
// constants stay separate so they can drift if a designer wants distinct
// weights or insets later.
const dividerRuleThickness = 1;
const headingRuleInsetY = 5;
const headingRuleMinimumWidth = 2;
const headingRuleThickness = 1;

export type VisibleHeadingRule = {
  bottom: number;
  left: number;
  right: number;
};

export type VisibleBlockquoteRegion = {
  bottom: number;
  isActive: boolean;
  left: number;
  top: number;
};

// Paints the once-per-block background that sits beneath a line — currently
// the code block fill or the table cell chrome. Only fires on the first line
// of the container so we don't repaint the same rectangle for every wrapped
// line in the cell or fence.
export function paintCanvasLineContainerBackground(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  block: Block | null,
  containerBounds: PaintRegionBounds | null,
  tableCellPosition: { cellIndex: number; rowIndex: number } | null,
  theme: EditorTheme,
  width: number,
) {
  if (!containerBounds || line.start !== 0) {
    return;
  }

  if (block?.type === "code") {
    const backgroundLeft = Math.max(0, line.left - codeBlockBackgroundHorizontalInset);

    context.fillStyle = theme.codeBackground;
    context.fillRect(
      backgroundLeft,
      containerBounds.top - codeBlockBackgroundTopInset,
      Math.max(
        containerBounds.right - line.left + codeBlockBackgroundMinimumWidthBoost,
        width - backgroundLeft,
      ),
      containerBounds.bottom - containerBounds.top + codeBlockBackgroundBottomInset,
    );
    return;
  }

  if (block?.type !== "table") {
    return;
  }

  paintTableCellChrome({
    context,
    containerBounds,
    isHeaderRow: tableCellPosition?.rowIndex === 0,
    lineHeight: line.height,
    theme,
  });
}

export function paintActiveBlockBackground(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  block: Block | null,
  runtimeBlockPath: string | null,
  activeBlockId: string | null,
  activeBlockFlashes: Map<string, ActiveBlockFlash>,
  theme: EditorTheme,
  width: number,
) {
  if (line.blockId !== activeBlockId || block?.type === "table") {
    return;
  }

  const activeBlockFlash = runtimeBlockPath
    ? (activeBlockFlashes.get(runtimeBlockPath) ?? null)
    : null;

  context.fillStyle = theme.activeBlockBackground;
  context.fillRect(0, line.top - activeLineVerticalBleed, width, line.height);

  if (!activeBlockFlash) {
    return;
  }

  context.fillStyle = resolveActiveBlockFlashColor(theme.activeBlockFlash, activeBlockFlash);
  context.fillRect(0, line.top - activeLineVerticalBleed, width, line.height);
}

export function resolveVisibleHeadingRules(
  layout: DocumentLayout,
  editorState: EditorState,
  runtimeBlockMap: Map<string, Block>,
  startIndex: number,
  endIndex: number,
  width: number,
) {
  const rules = new Map<string, VisibleHeadingRule>();

  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    const block = runtimeBlockMap.get(line.blockId);

    if (block?.type !== "heading" || (block.depth !== 1 && block.depth !== 2)) {
      continue;
    }

    const current = rules.get(block.id);
    const next: VisibleHeadingRule = {
      bottom: line.top + line.height,
      left: line.left + resolveLineContentInset(editorState, line),
      right: width - layout.options.paddingX,
    };

    rules.set(
      block.id,
      current
        ? {
            bottom: Math.max(current.bottom, next.bottom),
            left: current.left,
            right: current.right,
          }
        : next,
    );
  }

  return rules;
}

// Paints standalone block-level chrome for inert leaf blocks — those
// without any region (divider today; future image-as-block, embed,
// display-math). Iterates the visible slice of `layout.blocks` and
// dispatches by `block.type`. Text blocks are no-ops here; their chrome
// (heading rule, code background) is painted via the per-line container
// path or via heading-rule aggregation.
export function paintInertBlock(
  context: CanvasRenderingContext2D,
  layout: DocumentLayout,
  startIndex: number,
  endIndex: number,
  theme: EditorTheme,
  width: number,
) {
  for (let index = startIndex; index < endIndex; index += 1) {
    const block = layout.blocks[index]!;

    if (block.type === "divider") {
      // Span the rule across the content area (left inset through right
      // padding, matching the heading rule's right edge), vertically
      // centered in the block's geometry slot.
      const left = layout.options.paddingX + block.depth * layout.options.indentWidth;
      const right = width - layout.options.paddingX;
      const ruleTop = Math.round(block.top + (block.bottom - block.top - dividerRuleThickness) / 2);

      paintHorizontalRule(context, {
        color: theme.dividerRule ?? theme.headingRule,
        left,
        right,
        thickness: dividerRuleThickness,
        top: ruleTop,
      });
    }
  }
}

export function paintHeadingRules(
  context: CanvasRenderingContext2D,
  visibleHeadingRules: Map<string, VisibleHeadingRule>,
  theme: EditorTheme,
) {
  for (const rule of visibleHeadingRules.values()) {
    paintHorizontalRule(context, {
      color: theme.headingRule,
      left: rule.left,
      minimumWidth: headingRuleMinimumWidth,
      right: rule.right,
      thickness: headingRuleThickness,
      top: rule.bottom + headingRuleInsetY,
    });
  }
}

// Shared primitive for thin horizontal rules (heading underline, divider, and
// any future rule-shaped chrome). The caller computes geometry and styling;
// this owns the `fillStyle` + `fillRect` mechanics and the min-width clamp so
// both callers describe a rule declaratively rather than open-coding it.
function paintHorizontalRule(
  context: CanvasRenderingContext2D,
  rule: {
    color: string;
    left: number;
    minimumWidth?: number;
    right: number;
    thickness: number;
    top: number;
  },
) {
  context.fillStyle = rule.color;
  context.fillRect(
    rule.left,
    rule.top,
    Math.max(rule.minimumWidth ?? 0, rule.right - rule.left),
    rule.thickness,
  );
}

export function resolveVisibleBlockquoteRegions(
  layout: DocumentLayout,
  editorState: EditorState,
  activeBlockId: string | null,
  startIndex: number,
  endIndex: number,
) {
  const regions = new Map<string, VisibleBlockquoteRegion>();

  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    const blockquoteEntry = findBlockAncestor(editorState, line.blockId, "blockquote");

    if (!blockquoteEntry) {
      continue;
    }

    const current = regions.get(blockquoteEntry.id);
    const next: VisibleBlockquoteRegion = {
      bottom: line.top + line.height,
      isActive: line.blockId === activeBlockId,
      left: layout.options.paddingX + (blockquoteEntry.depth + 1) * layout.options.indentWidth - 10,
      top: line.top,
    };

    regions.set(
      blockquoteEntry.id,
      current
        ? {
            bottom: Math.max(current.bottom, next.bottom),
            isActive: current.isActive || next.isActive,
            left: current.left,
            top: Math.min(current.top, next.top),
          }
        : next,
    );
  }

  return regions;
}

export function paintBlockquoteRules(
  context: CanvasRenderingContext2D,
  visibleBlockquoteRegions: Map<string, VisibleBlockquoteRegion>,
  theme: EditorTheme,
) {
  for (const region of visibleBlockquoteRegions.values()) {
    context.fillStyle = region.isActive ? theme.blockquoteRuleActive : theme.blockquoteRule;
    context.fillRect(
      region.left,
      region.top + blockquoteRuleInsetY,
      blockquoteRuleWidth,
      Math.max(blockquoteRuleMinimumHeight, region.bottom - region.top - blockquoteRuleTrimY),
    );
  }
}
