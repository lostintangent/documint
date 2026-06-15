import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import type { EditorLayoutState, LayoutRect } from "@/editor/layout";
import { findVisibleBlockRange, findVisibleLineRange } from "@/editor/layout";
import { emptyDocumentResources } from "@/editor/resources";
import type { EditorState, NormalizedEditorSelection } from "@/editor/state";
import type { TextDecorationIndex } from "@/editor/text/decorations";
import type { DocumentResources, DocumintEffects, ResolvedEditorTheme } from "@/types";
import {
  resolveActiveEffects,
  type EffectPolicy,
  type BlockFlashFrame,
  type ActiveEditorEffect,
} from "../effects";
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
  const ambientTime = options.ambientTime ?? options.now;
  const visibleLines = findVisibleLineRange(layout, paintTop, options.height);
  const visibleBlocks = findVisibleBlockRange(layout, paintTop, options.height);
  const activeEffects = resolveActiveEffects(
    options.effects ?? [],
    options.now,
    options.effectPolicy,
    options.customEffects,
  );
  const resources = options.resources ?? emptyDocumentResources;
  const clocks: DocumentFrameClocks = {
    ambientTime,
  };
  const commentRangesByRegion = groupCommentRangesByRegion(options.commentRanges);
  const textDecorations = options.textDecorations ?? emptyTextDecorationIndex;
  const selectionRegionOrderRange = resolveSelectionRegionOrderRange(
    editorState,
    options.normalizedSelection,
  );
  const { chrome, listMarkerPlans } = resolveDocumentFrameChrome({
    blockFlashes: activeEffects.blockFlashes,
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
        blockFlashes: activeEffects.blockFlashes,
        activeBlockId: options.activeBlockId,
        blockPulses: activeEffects.blockPulses,
        textFades: activeEffects.textFades,
        textHighlights: activeEffects.textHighlights,
        textPulses: activeEffects.textPulses,
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
    activeBlockChangedEffect: resolveActiveBlockChangedEffectFrame(
      lines,
      chrome.activeTableCellHighlight,
    ),
    activeEffects: activeEffects.activeEditorEffects,
    chrome,
    clocks,
    customEffects: options.customEffects,
    layer: {
      devicePixelRatio: options.devicePixelRatio,
      height: options.height,
      paintTop,
      width: options.width,
    },
    lines,
    resources,
    theme: options.theme,
    viewport: {
      height: layoutState.viewport.height,
      left: 0,
      top: layoutState.viewport.top,
      width: layoutState.viewport.width,
    },
  };
}

type CreateDocumentFrameOptions = {
  activeBlockId: string | null;
  activeRegionId: string | null;
  activeThreadIndex: number | null;
  ambientTime?: number;
  commentPresence?: ReadonlyMap<number, EditorPresence>;
  commentRanges: EditorCommentRange[];
  customEffects?: DocumintEffects;
  devicePixelRatio: number;
  effectPolicy?: EffectPolicy;
  effects?: readonly ActiveEditorEffect[];
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
  readonly activeBlockChangedEffect: ActiveBlockChangedEffectFrame | null;
  readonly activeEffects: readonly ActiveEditorEffect[];
  readonly chrome: DocumentFrameChrome;
  readonly clocks: DocumentFrameClocks;
  readonly customEffects?: DocumintEffects;
  readonly layer: PaintLayerFrame;
  readonly lines: readonly DocumentFrameLine[];
  readonly resources: DocumentResources;
  readonly theme: ResolvedEditorTheme;
  readonly viewport: LayoutRect;
};

type DocumentFrameClocks = {
  readonly ambientTime: number;
};

export type PaintLayerFrame = {
  readonly devicePixelRatio: number;
  readonly height: number;
  readonly paintTop: number;
  readonly width: number;
};

export type ActiveBlockChangedEffectFrame = {
  readonly activeFlash: BlockFlashFrame;
  readonly bands: readonly LayoutRect[];
  readonly borderRect?: LayoutRect;
  readonly rect: LayoutRect;
};

function resolveActiveBlockChangedEffectFrame(
  lines: readonly DocumentFrameLine[],
  activeTableCellHighlight: DocumentFrameChrome["activeTableCellHighlight"],
): ActiveBlockChangedEffectFrame | null {
  if (activeTableCellHighlight?.activeFlash) {
    return {
      activeFlash: activeTableCellHighlight.activeFlash,
      bands: activeTableCellHighlight.bands,
      borderRect: activeTableCellHighlight.borderRect,
      rect: activeTableCellHighlight.borderRect,
    };
  }

  const bands: LayoutRect[] = [];
  let activeFlash: BlockFlashFrame | null = null;

  for (const line of lines) {
    const background = line.activeBlockBackground;

    if (!background?.activeFlash) {
      continue;
    }

    activeFlash ??= background.activeFlash;
    bands.push(background.rect);
  }

  if (!activeFlash || bands.length === 0) {
    return null;
  }

  return {
    activeFlash,
    bands,
    rect: unionRects(bands),
  };
}

function unionRects(rects: readonly LayoutRect[]): LayoutRect {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;

  for (const rect of rects) {
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.left + rect.width);
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.top + rect.height);
  }

  return {
    height: Math.max(0, bottom - top),
    left,
    top,
    width: Math.max(0, right - left),
  };
}
