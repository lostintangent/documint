import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import type { EditorLayoutState } from "@/editor/layout";
import { findVisibleBlockRange, findVisibleLineRange } from "@/editor/layout";
import { emptyDocumentResources } from "@/editor/resources";
import type { EditorState, NormalizedEditorSelection } from "@/editor/state";
import type { TextDecorationIndex } from "@/editor/text/decorations";
import type { DocumentResources, ResolvedEditorTheme } from "@/types";
import { resolveActiveAnimations } from "../animations";
import { resolveDocumentFrameChrome, type DocumentFrameChrome } from "./chrome";
import { resolveDocumentFrameLine, type DocumentFrameLine } from "./line";
import { resolveSelectionRegionOrderRange } from "./selection-frame";

const emptyTextDecorationIndex: TextDecorationIndex = new Map();
const emptyCommentPresence: ReadonlyMap<number, EditorPresence> = new Map();

export function createDocumentFrame(
  editorState: EditorState,
  layoutState: EditorLayoutState,
  options: CreateDocumentFrameOptions,
): DocumentFrame {
  const { layout, paintTop } = layoutState;
  const ambientAnimation = options.ambientAnimationTime ?? options.now;
  const visibleLines = findVisibleLineRange(layout, paintTop, options.height);
  const visibleBlocks = findVisibleBlockRange(layout, paintTop, options.height);
  const animations = resolveActiveAnimations(editorState, options.now);
  const resources = options.resources ?? emptyDocumentResources;
  const clocks: DocumentFrameClocks = {
    ambientAnimation,
  };
  const commentRangesByRegion = groupCommentRangesByRegion(options.commentRanges);
  const textDecorations = options.textDecorations ?? emptyTextDecorationIndex;
  const selectionRegionOrderRange = resolveSelectionRegionOrderRange(
    editorState,
    options.normalizedSelection,
  );
  const { chrome, listMarkerPlans } = resolveDocumentFrameChrome({
    activeBlockFlashes: animations.activeBlockFlashes,
    activeBlockId: options.activeBlockId,
    activeRegionId: options.activeRegionId,
    endBlockIndex: visibleBlocks.endIndex,
    editorState,
    endLineIndex: visibleLines.endIndex,
    layoutState,
    startBlockIndex: visibleBlocks.startIndex,
    startLineIndex: visibleLines.startIndex,
    width: options.width,
  });
  const lines: DocumentFrameLine[] = [];

  for (let index = visibleLines.startIndex; index < visibleLines.endIndex; index += 1) {
    lines.push(
      resolveDocumentFrameLine({
        activeBlockFlashes: animations.activeBlockFlashes,
        activeBlockId: options.activeBlockId,
        activeBlockPulses: animations.activeBlockPulses,
        activeTextFades: animations.activeTextFades,
        activeTextHighlights: animations.activeTextHighlights,
        activeTextPulses: animations.activeTextPulses,
        activeThreadIndex: options.activeThreadIndex,
        commentPresence: options.commentPresence ?? emptyCommentPresence,
        commentRangesByRegion,
        editorState,
        layoutState,
        line: layout.lines[index]!,
        normalizedSelection: options.normalizedSelection,
        selectionRegionOrderRange,
        textDecorations,
        resources,
        theme: options.theme,
        listMarkerPlans,
        width: options.width,
      }),
    );
  }

  return {
    chrome,
    clocks,
    layer: {
      devicePixelRatio: options.devicePixelRatio,
      height: options.height,
      paintTop,
      width: options.width,
    },
    lines,
    resources,
    theme: options.theme,
  };
}

type CreateDocumentFrameOptions = {
  activeBlockId: string | null;
  activeRegionId: string | null;
  activeThreadIndex: number | null;
  ambientAnimationTime?: number;
  commentPresence?: ReadonlyMap<number, EditorPresence>;
  commentRanges: EditorCommentRange[];
  devicePixelRatio: number;
  height: number;
  normalizedSelection: NormalizedEditorSelection;
  now: number;
  resources?: DocumentResources | null;
  textDecorations?: TextDecorationIndex;
  theme: ResolvedEditorTheme;
  width: number;
};

function groupCommentRangesByRegion(commentRanges: EditorCommentRange[]) {
  const rangesByRegion = new Map<string, EditorCommentRange[]>();

  for (const range of commentRanges) {
    const ranges = rangesByRegion.get(range.regionId);

    if (ranges) {
      ranges.push(range);
    } else {
      rangesByRegion.set(range.regionId, [range]);
    }
  }

  return rangesByRegion;
}

export type DocumentFrame = {
  readonly chrome: DocumentFrameChrome;
  readonly clocks: DocumentFrameClocks;
  readonly layer: PaintLayerFrame;
  readonly lines: readonly DocumentFrameLine[];
  readonly resources: DocumentResources;
  readonly theme: ResolvedEditorTheme;
};

type DocumentFrameClocks = {
  readonly ambientAnimation: number;
};

export type PaintLayerFrame = {
  readonly devicePixelRatio: number;
  readonly height: number;
  readonly paintTop: number;
  readonly width: number;
};
