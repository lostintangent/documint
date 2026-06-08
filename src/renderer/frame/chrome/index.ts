import type { EditorLayoutState, LayoutRect } from "@/editor/layout";
import { resolveIndexedBlock, type EditorState } from "@/editor/state";
import type { ActiveBlockFlash } from "../../effects";
import { resolveDividerRules } from "./divider-rules";
import {
  resolveBlockquoteRuleFrames,
  resolveHeadingRules,
  type BlockquoteRuleFrame,
} from "./rules";
import { resolveListMarkerPlans, type ListMarkerPlan } from "./list-markers";
import { resolveActiveTableCellHighlightFrame, type ActiveTableCellHighlightFrame } from "./table";

type ActiveTableCellHighlightTarget = {
  activeFlash: ActiveBlockFlash | null;
  activeRegionId: string;
};

export type DocumentFrameChrome = {
  readonly activeTableCellHighlight: ActiveTableCellHighlightFrame | null;
  readonly blockquoteRules: ReadonlyMap<string, BlockquoteRuleFrame>;
  readonly dividerRules: readonly LayoutRect[];
  readonly headingRules: ReadonlyMap<string, LayoutRect>;
};

type ResolvedDocumentFrameChrome = {
  chrome: DocumentFrameChrome;
  listMarkerPlans: Map<string, ListMarkerPlan>;
};

export function resolveDocumentFrameChrome({
  blockFlashes,
  activeBlockId,
  activeRegionId,
  endBlockIndex,
  editorState,
  endLineIndex,
  layoutState,
  startBlockIndex,
  startLineIndex,
  width,
}: {
  blockFlashes: Map<string, ActiveBlockFlash>;
  activeBlockId: string | null;
  activeRegionId: string | null;
  endBlockIndex: number;
  editorState: EditorState;
  endLineIndex: number;
  layoutState: EditorLayoutState;
  startBlockIndex: number;
  startLineIndex: number;
  width: number;
}): ResolvedDocumentFrameChrome {
  const { layout } = layoutState;
  const activeTableCellHighlight = resolveActiveTableCellHighlightTarget(
    editorState,
    activeBlockId,
    activeRegionId,
    blockFlashes,
  );

  return {
    chrome: {
      activeTableCellHighlight: activeTableCellHighlight
        ? resolveActiveTableCellHighlightFrame({
            activeFlash: activeTableCellHighlight.activeFlash,
            activeRegionId: activeTableCellHighlight.activeRegionId,
            endLineIndex,
            layout,
            regionBounds: layout.regionBounds,
            startLineIndex,
          })
        : null,
      blockquoteRules: resolveBlockquoteRuleFrames(
        layout,
        editorState,
        activeBlockId,
        startLineIndex,
        endLineIndex,
      ),
      dividerRules: resolveDividerRules(layout, startBlockIndex, endBlockIndex, width),
      headingRules: resolveHeadingRules(
        layout,
        editorState,
        startLineIndex,
        endLineIndex,
        width,
      ),
    },
    listMarkerPlans: resolveListMarkerPlans(
      layout,
      editorState,
      startLineIndex,
      endLineIndex,
    ),
  };
}

function resolveActiveTableCellHighlightTarget(
  editorState: EditorState,
  activeBlockId: string | null,
  activeRegionId: string | null,
  blockFlashes: Map<string, ActiveBlockFlash>,
): ActiveTableCellHighlightTarget | null {
  if (!activeBlockId || !activeRegionId) {
    return null;
  }

  const activeBlock = resolveIndexedBlock(editorState.documentIndex, activeBlockId);

  if (!activeBlock || activeBlock.block.type !== "table") {
    return null;
  }

  const activeCellRegion = editorState.documentIndex.regionIndex.get(activeRegionId) ?? null;

  if (activeCellRegion?.block.id !== activeBlockId) {
    return null;
  }

  return {
    activeFlash: activeBlock.path ? (blockFlashes.get(activeBlock.path) ?? null) : null,
    activeRegionId,
  };
}
