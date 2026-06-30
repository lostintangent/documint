import type { EditorLayoutState, LayoutRect } from "@/editor/layout";
import { resolveIndexedBlock, resolveIndexedTableCell, type EditorState } from "@/editor/state";
import type { BlockFlashFrame } from "../../effects";
import { resolveDividerRules } from "./divider-rules";
import {
  resolveBlockquoteRuleFrames,
  resolveHeadingRules,
  type BlockquoteRuleFrame,
} from "./rules";
import { resolveListMarkerPlans, type ListMarkerPlan } from "./list-markers";
import {
  resolveActiveTableCellGeometryFrame,
  type ActiveTableCellGeometryFrame,
} from "./table";

type ActiveTableCellGeometryTarget = {
  activeFlash: BlockFlashFrame | null;
  activePath: string;
};

export type DocumentFrameChrome = {
  readonly activeTableCellGeometry: ActiveTableCellGeometryFrame | null;
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
  activeBlockPath,
  activePath,
  endBlockIndex,
  editorState,
  endLineIndex,
  layoutState,
  startBlockIndex,
  startLineIndex,
  width,
}: {
  blockFlashes: Map<string, BlockFlashFrame>;
  activeBlockPath: string | null;
  activePath: string | null;
  endBlockIndex: number;
  editorState: EditorState;
  endLineIndex: number;
  layoutState: EditorLayoutState;
  startBlockIndex: number;
  startLineIndex: number;
  width: number;
}): ResolvedDocumentFrameChrome {
  const { layout } = layoutState;
  const activeTableCellGeometry = resolveActiveTableCellGeometryTarget(
    editorState,
    activeBlockPath,
    activePath,
    blockFlashes,
  );

  return {
    chrome: {
      activeTableCellGeometry: activeTableCellGeometry
        ? resolveActiveTableCellGeometryFrame({
            activeFlash: activeTableCellGeometry.activeFlash,
            activePath: activeTableCellGeometry.activePath,
            endLineIndex,
            layout,
            pathBounds: layout.pathBounds,
            startLineIndex,
          })
        : null,
      blockquoteRules: resolveBlockquoteRuleFrames(
        layout,
        editorState,
        activeBlockPath,
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

function resolveActiveTableCellGeometryTarget(
  editorState: EditorState,
  activeBlockPath: string | null,
  activePath: string | null,
  blockFlashes: Map<string, BlockFlashFrame>,
): ActiveTableCellGeometryTarget | null {
  if (!activeBlockPath || !activePath) {
    return null;
  }

  const activeBlock = resolveIndexedBlock(editorState.documentIndex, activeBlockPath);

  if (!activeBlock || activeBlock.block.type !== "table") {
    return null;
  }

  const activeCell = resolveIndexedTableCell(editorState.documentIndex, activePath);

  if (activeCell?.tablePath !== activeBlockPath) {
    return null;
  }

  return {
    activeFlash: activeBlock.path ? (blockFlashes.get(activeBlock.path) ?? null) : null,
    activePath,
  };
}
