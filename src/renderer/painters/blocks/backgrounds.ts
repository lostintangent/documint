// Owns block-level backgrounds — the fills that sit beneath a block rather
// than inside its inline content. Three call shapes:
//   - per-line `paintLineContainerBackground` for chrome that paints on the
//     first line of a region (code background, table cell chrome)
//   - per-line `paintActiveBlockBackground` for the active-block tint
//   - frame-level `paintActiveBlockHighlight`, the stage-4 dispatcher that
//     decides which block-type-specific highlight to paint for the active
//     block (today: table cell band; future: code/embed/etc.)
//
// Block-type-specific draw primitives live next to their painter family
// (e.g. `painters/table.ts` for table cell chrome). This file owns the
// dispatch and the generic active-block tint.

import type { Block } from "@/document";
import type { DocumentLayout } from "@/editor/layout";
import { type EditorState } from "@/editor/state";
import type { EditorTheme } from "@/types";
import { resolveActiveBlockFlashColor, type ActiveBlockFlash } from "../../animations";
import {
  paintActiveTableCellHighlight,
  paintTableCellChrome,
  type PaintRegionBounds,
} from "../table";

export const activeLineVerticalBleed = 2;

const codeBlockBackgroundBottomInset = 8;
const codeBlockBackgroundHorizontalInset = 12;
const codeBlockBackgroundMinimumWidthBoost = 28;
const codeBlockBackgroundTopInset = 4;

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

// Stage-4 dispatcher. The active block's chrome differs by type — today only
// table cells need a band painted across the active cell — but this is the
// place new block-type highlights land (code fences, embeds, etc.). Each
// block-type case delegates the actual drawing to its painter family.
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
  theme: EditorTheme;
}) {
  if (!activeBlockId || !activeRegionId) {
    return;
  }

  const activeBlock = editorState.documentIndex.blockIndex.get(activeBlockId) ?? null;

  if (!activeBlock) {
    return;
  }

  if (activeBlock.type === "table") {
    const activeCellRegion = editorState.documentIndex.regionIndex.get(activeRegionId) ?? null;

    if (activeCellRegion?.blockId !== activeBlockId) {
      return;
    }

    const activeFlash = activeBlock.path
      ? (activeBlockFlashes.get(activeBlock.path) ?? null)
      : null;

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
}
