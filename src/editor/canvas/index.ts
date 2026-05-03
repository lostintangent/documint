// Owns the top-level canvas paint pipeline. The editor mounts two stacked
// canvases — content and overlay — and this module is the single entry point
// each frame. The pipeline is staged so that backgrounds, foregrounds, and
// rules paint in a fixed z-order regardless of what runs inside each line.
//
// Stages, in order:
//   1.  clear + base background
//   2.  per-visible-line block backgrounds     (delegated to painters/block-chrome.ts)
//   2b. inert block chrome                     (delegated to painters/block-chrome.ts)
//   3.  active table cell highlight pass       (delegated to painters/table.ts)
//   4.  per-visible-line foreground            (sub-pipeline below)
//   5.  heading rules + blockquote rules       (delegated to painters/block-chrome.ts)
//
// Stage 2b paints standalone block-level chrome (the divider rule today;
// future image-as-block, embed, display-math). It runs after stage 2 so
// per-line backgrounds for adjacent text blocks are already down, and
// before stage 3 so active-cell highlights for tables sit on top.
//
// The per-line foreground sub-pipeline (`paintDocumentLineForeground`):
//   active-block bg → selection → comments → list marker → text runs
//   → deleted-text fades → punctuation pulses
//
// Pixel-drawing modules live in painters/. Shared building blocks
// (animations, color blending, font metrics, render cache) live in lib/.

import type { Block } from "@/document";
import type { EditorCommentRange, EditorPresence } from "../anchors";
import type { EditorLayoutState } from "../layout";
import {
  findBlockAncestor,
  findVisibleBlockRange,
  findVisibleLineRange,
  resolveLineContentInset,
  resolveListItemMarker,
  type DocumentLayout,
} from "../layout";
import type { EditorState, NormalizedEditorSelection } from "../state";
import type { DocumentResources, EditorTheme } from "@/types";
import {
  resolveActiveBlockFlashes,
  resolveActiveDeletedTextFades,
  resolveActiveInsertedTextHighlights,
  resolveActiveListMarkerPops,
  resolveActivePunctuationPulses,
  type ActiveBlockFlash,
  type ActiveDeletedTextFade,
  type ActiveInsertedTextHighlight,
  type ActiveListMarkerPop,
  type ActivePunctuationPulse,
} from "./lib/animations";
import { resolveCanvasCenteredTextBaseline } from "./lib/fonts";
import {
  activeLineVerticalBleed,
  paintActiveBlockBackground,
  paintBlockquoteRules,
  paintCanvasLineContainerBackground,
  paintHeadingRules,
  paintInertBlock,
  resolveVisibleBlockquoteRegions,
  resolveVisibleHeadingRules,
} from "./painters/block-chrome";
import { paintCanvasCaretOverlay } from "./painters/caret";
import { paintListMarker } from "./painters/list";
import {
  paintCanvasCommentHighlights,
  paintSelectionHighlight,
  resolveSelectionRegionOrderRange,
  type SelectionRegionOrderRange,
} from "./painters/selection";
import {
  paintActiveTableCellHighlightPass,
  type PaintRegionBounds,
} from "./painters/table";
import {
  paintCanvasDeletedTextFades,
  paintCanvasLineText,
  paintCanvasPunctuationPulses,
} from "./painters/text";

export type CanvasSelectionRange = {
  end: { regionId: string; offset: number };
  start: { regionId: string; offset: number };
};

// Re-export painter entry points used outside this folder (tests, primarily).
// External callers should not reach into painters/ directly.
export { paintCanvasCaretOverlay } from "./painters/caret";

// Editor-facing entry point for the content canvas. Thin wrapper that pulls
// pieces off the viewport snapshot and forwards into the orchestrator.
export function paintContent(
  state: EditorState,
  viewport: EditorLayoutState,
  context: CanvasRenderingContext2D,
  options: {
    activeBlockId: string | null;
    activeRegionId: string | null;
    activeThreadIndex: number | null;
    devicePixelRatio: number;
    height: number;
    liveCommentRanges: EditorCommentRange[];
    normalizedSelection: NormalizedEditorSelection;
    now?: number;
    resources?: DocumentResources | null;
    theme: EditorTheme;
    width: number;
  },
): void {
  paintCanvasEditorSurface({
    activeBlockId: options.activeBlockId,
    activeRegionId: options.activeRegionId,
    activeThreadIndex: options.activeThreadIndex,
    containerLineBounds: viewport.regionBounds,
    context,
    devicePixelRatio: options.devicePixelRatio,
    editorState: state,
    height: options.height,
    layout: viewport.layout,
    liveCommentRanges: options.liveCommentRanges,
    normalizedSelection: options.normalizedSelection,
    now: options.now,
    resources: options.resources ?? { images: new Map() },
    runtimeBlockMap: viewport.blockMap,
    theme: options.theme,
    viewportTop: viewport.paintTop,
    width: options.width,
  });
}

// Editor-facing entry point for the overlay canvas. Carets only — selection
// and comment highlights live on the content canvas so they don't repaint
// every blink tick.
export function paintOverlay(
  state: EditorState,
  viewport: EditorLayoutState,
  context: CanvasRenderingContext2D,
  options: {
    devicePixelRatio: number;
    height: number;
    normalizedSelection: NormalizedEditorSelection;
    presence?: EditorPresence[];
    showCaret: boolean;
    theme: EditorTheme;
    width: number;
  },
): void {
  paintCanvasCaretOverlay({
    context,
    devicePixelRatio: options.devicePixelRatio,
    editorState: state,
    height: options.height,
    layout: viewport.layout,
    normalizedSelection: options.normalizedSelection,
    presence: options.presence,
    showCaret: options.showCaret,
    theme: options.theme,
    viewportTop: viewport.paintTop,
    width: options.width,
  });
}

// Viewport-level orchestrator. Owns the staging order; delegates each stage's
// work to a sibling module. Intentionally exported so tests can drive it
// without going through the React surface.
export function paintCanvasEditorSurface({
  activeBlockId,
  activeRegionId,
  activeThreadIndex,
  containerLineBounds,
  context,
  devicePixelRatio,
  editorState,
  height,
  layout,
  liveCommentRanges,
  normalizedSelection,
  now = getPaintTime(),
  resources,
  runtimeBlockMap,
  theme,
  viewportTop,
  width,
}: {
  activeBlockId: string | null;
  activeRegionId: string | null;
  activeThreadIndex: number | null;
  containerLineBounds: Map<string, PaintRegionBounds>;
  context: CanvasRenderingContext2D;
  devicePixelRatio: number;
  editorState: EditorState;
  height: number;
  layout: DocumentLayout;
  liveCommentRanges: EditorCommentRange[];
  normalizedSelection: CanvasSelectionRange;
  now?: number;
  resources: DocumentResources;
  runtimeBlockMap: Map<string, Block>;
  theme: EditorTheme;
  viewportTop: number;
  width: number;
}) {
  context.save();
  context.scale(devicePixelRatio, devicePixelRatio);
  context.clearRect(0, 0, width, height);
  context.fillStyle = theme.background;
  context.fillRect(0, 0, width, height);
  context.textBaseline = "alphabetic";
  context.translate(0, -viewportTop);

  // Resolve everything that's constant across the per-line passes once.
  const { endIndex, startIndex } = findVisibleLineRange(layout, viewportTop, height);
  const selectionRegionOrderRange = resolveSelectionRegionOrderRange(
    editorState,
    normalizedSelection,
  );
  const activeBlockFlashes = resolveActiveBlockFlashes(editorState, now);
  const activeDeletedTextFades = resolveActiveDeletedTextFades(editorState, now);
  const activeInsertedTextHighlights = resolveActiveInsertedTextHighlights(editorState, now);
  const activeListMarkerPops = resolveActiveListMarkerPops(editorState, now);
  const activePunctuationPulses = resolveActivePunctuationPulses(editorState, now);
  const visibleBlockquoteRegions = resolveVisibleBlockquoteRegions(
    layout,
    editorState,
    activeBlockId,
    startIndex,
    endIndex,
  );
  const visibleHeadingRules = resolveVisibleHeadingRules(
    layout,
    editorState,
    runtimeBlockMap,
    startIndex,
    endIndex,
    width,
  );

  // Stage 2: per-line block backgrounds (code fences, table cell chrome).
  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    paintCanvasLineContainerBackground(
      context,
      line,
      runtimeBlockMap.get(line.blockId) ?? null,
      containerLineBounds.get(line.regionId) ?? null,
      editorState.documentIndex.tableCellIndex.get(line.regionId) ?? null,
      theme,
      width,
    );
  }

  // Stage 2b: inert block chrome (divider rule today; future image-as-block,
  // embed, display-math). Iterates the visible slice of `layout.blocks` and
  // dispatches by `block.type`. Text blocks no-op here — their chrome paints
  // via stage 2 (code/table) or stage 5 (heading/blockquote rules).
  const visibleBlockRange = findVisibleBlockRange(layout, viewportTop, height);
  paintInertBlock(
    context,
    layout,
    visibleBlockRange.startIndex,
    visibleBlockRange.endIndex,
    theme,
    width,
  );

  // Stage 3: active table cell band, painted after backgrounds and before
  // foregrounds so the cell highlight sits behind text but on top of borders.
  paintActiveTableCellHighlightPass({
    activeBlockFlashes,
    activeBlockId,
    activeRegionId,
    context,
    editorState,
    endIndex,
    layout,
    regionBounds: containerLineBounds,
    startIndex,
    theme,
    verticalBleed: activeLineVerticalBleed,
  });

  // Stage 4: per-line foreground (text, decorations, markers, effects).
  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    paintDocumentLineForeground({
      activeBlockId,
      activeBlockFlashes,
      activeDeletedTextFades,
      activeInsertedTextHighlights,
      activeListMarkerPops,
      activePunctuationPulses,
      activeThreadIndex,
      context,
      editorState,
      line,
      liveCommentRanges,
      normalizedSelection,
      resources,
      runtimeBlockMap,
      selectionRegionOrderRange,
      theme,
      width,
    });
  }

  // Stage 5: rules (heading underline, blockquote bar) painted last so they
  // sit on top of any foreground that bled into their geometry.
  paintHeadingRules(context, visibleHeadingRules, theme);
  paintBlockquoteRules(context, visibleBlockquoteRegions, theme);

  context.restore();
}

// Per-line foreground sub-pipeline. Intentionally short and linear — each call
// is a single visual concern, ordered by z-stack.
function paintDocumentLineForeground({
  activeBlockId,
  activeBlockFlashes,
  activeDeletedTextFades,
  activeInsertedTextHighlights,
  activeListMarkerPops,
  activePunctuationPulses,
  activeThreadIndex,
  context,
  editorState,
  line,
  liveCommentRanges,
  normalizedSelection,
  resources,
  runtimeBlockMap,
  selectionRegionOrderRange,
  theme,
  width,
}: {
  activeBlockId: string | null;
  activeBlockFlashes: Map<string, ActiveBlockFlash>;
  activeDeletedTextFades: Map<string, ActiveDeletedTextFade[]>;
  activeInsertedTextHighlights: Map<string, ActiveInsertedTextHighlight[]>;
  activeListMarkerPops: Map<string, ActiveListMarkerPop>;
  activePunctuationPulses: Map<string, ActivePunctuationPulse[]>;
  activeThreadIndex: number | null;
  context: CanvasRenderingContext2D;
  editorState: EditorState;
  line: DocumentLayout["lines"][number];
  liveCommentRanges: EditorCommentRange[];
  normalizedSelection: CanvasSelectionRange;
  resources: DocumentResources;
  runtimeBlockMap: Map<string, Block>;
  selectionRegionOrderRange: SelectionRegionOrderRange | null;
  theme: EditorTheme;
  width: number;
}) {
  const snapshotBlock = runtimeBlockMap.get(line.blockId) ?? null;
  const runtimeBlockPath = editorState.documentIndex.blockIndex.get(line.blockId)?.path ?? null;
  const container = editorState.documentIndex.regionIndex.get(line.regionId) ?? null;
  const containerPath = container?.path ?? "";
  const listItemEntry = findBlockAncestor(editorState, line.blockId, "listItem");
  const listMarker = listItemEntry ? resolveListItemMarker(editorState, listItemEntry.id) : null;
  const listMarkerPop = listItemEntry
    ? (activeListMarkerPops.get(listItemEntry.path) ?? null)
    : null;
  const textLeft = line.left + resolveLineContentInset(editorState, line);
  const textBaseline = resolveCanvasLineTextBaseline(line);
  const defaultTextColor =
    snapshotBlock?.type === "code" ? theme.codeText : resolveCanvasTextColor(snapshotBlock, theme);

  context.font = line.font;

  paintActiveBlockBackground(
    context,
    line,
    snapshotBlock,
    runtimeBlockPath,
    activeBlockId,
    activeBlockFlashes,
    theme,
    width,
  );
  paintSelectionHighlight(
    context,
    editorState,
    line,
    normalizedSelection,
    selectionRegionOrderRange,
    theme,
  );
  paintCanvasCommentHighlights(
    context,
    editorState,
    line,
    liveCommentRanges,
    activeThreadIndex,
    theme,
  );
  paintListMarker(context, line, listMarker, textLeft, textBaseline, theme, listMarkerPop);
  paintCanvasLineText(
    context,
    line,
    container,
    textLeft,
    textBaseline,
    activeInsertedTextHighlights.get(containerPath) ?? [],
    defaultTextColor,
    resources,
    theme,
  );
  paintCanvasDeletedTextFades(
    context,
    line,
    container,
    textLeft,
    textBaseline,
    activeDeletedTextFades.get(containerPath) ?? [],
    defaultTextColor,
  );
  paintCanvasPunctuationPulses(
    context,
    line,
    container,
    textLeft,
    textBaseline,
    activePunctuationPulses.get(containerPath) ?? [],
    theme,
  );
}

function resolveCanvasLineTextBaseline(line: DocumentLayout["lines"][number]) {
  return line.top + resolveCanvasCenteredTextBaseline(line.height, line.font);
}

function resolveCanvasTextColor(block: Block | null, theme: EditorTheme) {
  switch (block?.type) {
    case "heading":
      return theme.headingText;
    case "blockquote":
      return theme.blockquoteText;
    case "table":
      return theme.headingText;
    default:
      return theme.paragraphText;
  }
}

function getPaintTime() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
