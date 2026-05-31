// Owns block-level surfaces: durable block chrome (code backgrounds, table
// cell fills) and the transient active-block tint that sits above it.
//
// Most text blocks use the generic per-line active tint. Blocks with their
// own chrome specialize only the tint positioning: code fences align to their
// background surface, and tables delegate to table-cell geometry.
//
// Block-type-specific draw primitives live next to their painter family
// (e.g. `painters/table.ts` for table cell chrome). This file owns the
// dispatch and shared active tint/flash fill.

import type { Block } from "@/document";
import { type DocumentLayout, resolveCodeBlockBackgroundBounds } from "@/editor/layout";
import { resolveIndexedBlock, type EditorState } from "@/editor/state";
import type { ResolvedEditorTheme } from "@/types";
import { resolveActiveBlockFlashColor, type ActiveBlockFlash } from "../../animations";
import {
  paintActiveTableCellHighlight,
  paintTableCellChrome,
  type PaintRegionBounds,
} from "../table";
import type { PaintRect } from "../geometry";

export const activeLineVerticalBleed = 2;

// Paints the once-per-block background that sits beneath a line — currently
// the code block fill or the table cell chrome. Only fires on the first line
// of the container so we don't repaint the same rectangle for every wrapped
// line in the cell or fence.
export function paintLineContainerBackground(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  block: Block | null,
  containerBounds: PaintRegionBounds | null,
  tableCellPosition: { cellIndex: number; rowIndex: number } | null,
  theme: ResolvedEditorTheme,
  layout: DocumentLayout,
) {
  if (!containerBounds || line.start !== 0) {
    return;
  }

  if (block?.type === "code") {
    const bounds = resolveCodeBlockBackgroundBounds(layout, line, containerBounds);

    context.fillStyle = theme.codeBackground;
    context.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
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
  containerBounds: PaintRegionBounds | null,
  runtimeBlockPath: string | null,
  activeBlockId: string | null,
  activeBlockFlashes: Map<string, ActiveBlockFlash>,
  theme: ResolvedEditorTheme,
  layout: DocumentLayout,
  width: number,
) {
  if (line.blockId !== activeBlockId) {
    return;
  }

  // Blocks with their own chrome need active tint bounds that match that
  // chrome. Tables paint active cell bounds in `paintActiveBlockHighlight`
  // because that requires row/cell context; code fences resolve their own
  // paint rect here because their background bounds are line-local.
  const rect = resolveActiveBlockPaintRect(block, line, containerBounds, layout, width);

  if (!rect) {
    return;
  }

  const activeBlockFlash = runtimeBlockPath
    ? (activeBlockFlashes.get(runtimeBlockPath) ?? null)
    : null;

  paintActiveBlockRect(context, rect, activeBlockFlash, theme);
}

function resolveActiveBlockPaintRect(
  block: Block | null,
  line: DocumentLayout["lines"][number],
  containerBounds: PaintRegionBounds | null,
  layout: DocumentLayout,
  width: number,
): PaintRect | null {
  if (block?.type === "table") {
    return null;
  }

  if (block?.type === "code") {
    if (!containerBounds || line.start !== 0) {
      return null;
    }

    const backgroundBounds = resolveCodeBlockBackgroundBounds(layout, line, containerBounds);

    return {
      height: containerBounds.bottom - containerBounds.top,
      left: backgroundBounds.left,
      top: containerBounds.top,
      width: backgroundBounds.width,
    };
  }

  return {
    height: line.height,
    left: 0,
    top: line.top - activeLineVerticalBleed,
    width,
  };
}

function paintActiveBlockRect(
  context: CanvasRenderingContext2D,
  rect: PaintRect,
  activeBlockFlash: ActiveBlockFlash | null,
  theme: ResolvedEditorTheme,
) {
  context.fillStyle = theme.activeBlockBackground;
  context.fillRect(rect.left, rect.top, rect.width, rect.height);

  if (!activeBlockFlash) {
    return;
  }

  context.fillStyle = resolveActiveBlockFlashColor(theme.activeBlockFlash, activeBlockFlash);
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
}

// Frame-level active tint for chrome that cannot be resolved from one text
// line. Table cells own borders and row/cell geometry, so their active tint
// is positioned by the table painter instead of the generic line pass above.
export function paintActiveBlockHighlight({
  activeBlockFlashes,
  activeBlockId,
  activeRegionId,
  context,
  editorState,
  endIndex,
  layout,
  regionBounds,
  startIndex,
  theme,
}: {
  activeBlockFlashes: Map<string, ActiveBlockFlash>;
  activeBlockId: string | null;
  activeRegionId: string | null;
  context: CanvasRenderingContext2D;
  editorState: EditorState;
  endIndex: number;
  layout: DocumentLayout;
  regionBounds: Map<string, PaintRegionBounds>;
  startIndex: number;
  theme: ResolvedEditorTheme;
}) {
  if (!activeBlockId || !activeRegionId) {
    return;
  }

  const activeBlock = resolveIndexedBlock(editorState.documentIndex, activeBlockId);

  if (!activeBlock) {
    return;
  }

  if (activeBlock.block.type !== "table") {
    return;
  }

  const activeCellRegion = editorState.documentIndex.regionIndex.get(activeRegionId) ?? null;

  if (activeCellRegion?.block.id !== activeBlockId) {
    return;
  }

  const activeFlash = activeBlock.path ? (activeBlockFlashes.get(activeBlock.path) ?? null) : null;

  paintActiveTableCellHighlight({
    activeFlash,
    activeRegionId,
    context,
    endIndex,
    layout,
    regionBounds,
    startIndex,
    theme,
    verticalBleed: activeLineVerticalBleed,
  });
}
