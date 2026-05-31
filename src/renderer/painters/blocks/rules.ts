// Owns block-level rules — the thin horizontal/vertical strokes that frame
// a block rather than fill it: heading underlines, blockquote bars, and the
// divider rule. Each rule has a per-block-aggregate resolver that the
// orchestrator runs once over the visible range; the painters then take a
// finished map and stroke. Inert leaf blocks (divider today; future
// image-as-block, embed, display-math) are dispatched by `paintInertBlock`
// over the visible block slice.

import { resolveLineContentInset, type DocumentLayout } from "@/editor/layout";
import { findAncestorIndexedBlock, resolveBlock, type EditorState } from "@/editor/state";
import type { ResolvedEditorTheme } from "@/types";

const blockquoteRuleBottomInset = 3;
const blockquoteRuleMinimumHeight = 12;
const blockquoteRuleTopBleed = 1;
const blockquoteRuleWidth = 3;

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

export function resolveVisibleHeadingRules(
  layout: DocumentLayout,
  editorState: EditorState,
  startIndex: number,
  endIndex: number,
  width: number,
) {
  const rules = new Map<string, VisibleHeadingRule>();

  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    const block = resolveBlock(editorState.documentIndex, line.blockId);

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
  theme: ResolvedEditorTheme,
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
        color: theme.dividerRule,
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
  theme: ResolvedEditorTheme,
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
    const blockquoteEntry = findAncestorIndexedBlock(
      editorState.documentIndex,
      line.blockId,
      "blockquote",
    );

    if (!blockquoteEntry) {
      continue;
    }

    const current = regions.get(blockquoteEntry.block.id);
    const next: VisibleBlockquoteRegion = {
      bottom: line.top + line.height,
      isActive: line.blockId === activeBlockId,
      left: layout.options.paddingX + (blockquoteEntry.depth + 1) * layout.options.indentWidth - 10,
      top: line.top,
    };

    regions.set(
      blockquoteEntry.block.id,
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
  theme: ResolvedEditorTheme,
) {
  for (const region of visibleBlockquoteRegions.values()) {
    const top = region.top - blockquoteRuleTopBleed;
    const bottom = region.bottom - blockquoteRuleBottomInset;

    context.fillStyle = region.isActive ? theme.blockquoteRuleActive : theme.blockquoteRule;
    context.fillRect(
      region.left,
      top,
      blockquoteRuleWidth,
      Math.max(blockquoteRuleMinimumHeight, bottom - top),
    );
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
