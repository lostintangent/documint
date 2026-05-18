// Owns the top-level canvas paint pipeline. The host mounts two stacked
// canvases — content and overlay — and this module is the renderer entry
// point each frame, exporting `paintContent` and `paintOverlay`. Tests drive
// the same surface as the host.
//
// See AGENTS.md in this folder for the pipeline z-order, the two-clock model
// (`now` vs `ambientAnimationTime`), the block-snapshots-vs-block-index
// distinction, and the cache lifetimes. The stages are commented in line
// below so they're greppable from the code; AGENTS.md is the source of
// truth for ordering rationale.

import type { Block } from "@/document";
import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import type { EditorLayoutState } from "@/editor/layout";
import {
  findVisibleBlockRange,
  findVisibleLineRange,
  resolveLineContentInset,
  resolveListItemMarker,
  type DocumentLayout,
} from "@/editor/layout";
import {
  findAncestorBlockEntry,
  type EditorState,
  type NormalizedEditorSelection,
} from "@/editor/state";
import type { DocumentResources, EditorTheme } from "@/types";
import type { TextDecorationIndex } from "@/editor/text/decorations";
import {
  resolveActiveBlockFlashes,
  resolveActiveTextFades,
  resolveActiveTextHighlights,
  resolveActiveBlockPulses,
  resolveActiveTextPulses,
  type ActiveBlockFlash,
  type ActiveTextFade,
  type ActiveTextHighlight,
  type ActiveBlockPulse,
  type ActiveTextPulse,
} from "./animations";
import { resolveCenteredTextBaseline } from "@/editor/text/measure";
import {
  activeLineVerticalBleed,
  paintActiveBlockBackground,
  paintBlockquoteRules,
  paintLineContainerBackground,
  paintHeadingRules,
  paintInertBlock,
  resolveVisibleBlockquoteRegions,
  resolveVisibleHeadingRules,
} from "./painters/block-chrome";
import { paintCaretOverlay } from "./painters/caret";
import { paintListMarker } from "./painters/list";
import {
  paintCommentHighlights,
  paintSelectionHighlight,
  resolveSelectionRegionOrderRange,
  type SelectionRegionOrderRange,
} from "./painters/selection";
import { paintActiveTableCellHighlightPass, type PaintRegionBounds } from "./painters/table";
import {
  paintTextFades,
  paintTextHighlights,
  paintLineText,
  paintTextPulses,
  paintTextDecorations,
} from "./painters/text";

const emptyTextDecorationIndex: TextDecorationIndex = new Map();
const emptyPresenceThreadColors: ReadonlyMap<number, string | null> = new Map();

type PaintLayerOptions = {
  devicePixelRatio: number;
  height: number;
  normalizedSelection: NormalizedEditorSelection;
  theme: EditorTheme;
  width: number;
};

type PaintContentOptions = PaintLayerOptions & {
  activeBlockId: string | null;
  activeRegionId: string | null;
  activeThreadIndex: number | null;
  ambientAnimationTime?: number;
  commentRanges: EditorCommentRange[];
  presenceActiveThreadColors?: ReadonlyMap<number, string | null>;
  now?: number;
  resources?: DocumentResources | null;
  textDecorations?: TextDecorationIndex;
};

type PaintOverlayOptions = PaintLayerOptions & {
  presence?: EditorPresence[];
  showCaret: boolean;
};

// Renderer entry point for the content canvas. Thin wrapper that pulls
// pieces off the viewport snapshot and forwards into the orchestrator.
export function paintContent(
  state: EditorState,
  viewport: EditorLayoutState,
  context: CanvasRenderingContext2D,
  options: PaintContentOptions,
): void {
  paintContentLayer({
    activeBlockId: options.activeBlockId,
    activeRegionId: options.activeRegionId,
    activeThreadIndex: options.activeThreadIndex,
    ambientAnimationTime: options.ambientAnimationTime,
    containerLineBounds: viewport.layout.regionBounds,
    context,
    devicePixelRatio: options.devicePixelRatio,
    editorState: state,
    height: options.height,
    layout: viewport.layout,
    commentRanges: options.commentRanges,
    normalizedSelection: options.normalizedSelection,
    presenceActiveThreadColors: options.presenceActiveThreadColors ?? emptyPresenceThreadColors,
    now: options.now,
    resources: options.resources ?? { images: new Map() },
    blockSnapshots: viewport.blockMap,
    textDecorations: options.textDecorations ?? emptyTextDecorationIndex,
    theme: options.theme,
    viewportTop: viewport.paintTop,
    width: options.width,
  });
}

// Renderer entry point for the overlay canvas. Carets only — selection
// and comment highlights live on the content canvas so they don't repaint
// every blink tick.
export function paintOverlay(
  state: EditorState,
  viewport: EditorLayoutState,
  context: CanvasRenderingContext2D,
  options: PaintOverlayOptions,
): void {
  paintCaretOverlay({
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
// work to a sibling module. Private — `paintContent` is the only entry; tests
// drive through it the same way the host does.
function paintContentLayer({
  activeBlockId,
  activeRegionId,
  activeThreadIndex,
  containerLineBounds,
  context,
  devicePixelRatio,
  editorState,
  height,
  layout,
  commentRanges,
  normalizedSelection,
  now = getPaintTime(),
  ambientAnimationTime = now,
  presenceActiveThreadColors = emptyPresenceThreadColors,
  resources,
  blockSnapshots,
  textDecorations = emptyTextDecorationIndex,
  theme,
  viewportTop,
  width,
}: {
  activeBlockId: string | null;
  activeRegionId: string | null;
  activeThreadIndex: number | null;
  containerLineBounds: Map<string, PaintRegionBounds>;
  ambientAnimationTime?: number;
  context: CanvasRenderingContext2D;
  devicePixelRatio: number;
  editorState: EditorState;
  height: number;
  layout: DocumentLayout;
  commentRanges: EditorCommentRange[];
  normalizedSelection: NormalizedEditorSelection;
  presenceActiveThreadColors?: ReadonlyMap<number, string | null>;
  now?: number;
  resources: DocumentResources;
  blockSnapshots: Map<string, Block>;
  textDecorations?: TextDecorationIndex;
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
  const activeTextFades = resolveActiveTextFades(editorState, now);
  const activeTextHighlights = resolveActiveTextHighlights(editorState, now);
  const activeBlockPulses = resolveActiveBlockPulses(editorState, now);
  const activeTextPulses = resolveActiveTextPulses(editorState, now);
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
    blockSnapshots,
    startIndex,
    endIndex,
    width,
  );

  // Stage 2: per-visible-line block backgrounds (code fences, table cell chrome).
  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    paintLineContainerBackground(
      context,
      line,
      blockSnapshots.get(line.blockId) ?? null,
      containerLineBounds.get(line.regionId) ?? null,
      editorState.documentIndex.tableCellIndex.get(line.regionId) ?? null,
      theme,
      width,
    );
  }

  // Stage 3: inert block chrome (divider rule today; future image-as-block,
  // embed, display-math). Iterates the visible slice of `layout.blocks` and
  // dispatches by `block.type`. Text blocks no-op here — their chrome paints
  // via stage 2 (code/table) or stage 6 (heading/blockquote rules).
  const visibleBlockRange = findVisibleBlockRange(layout, viewportTop, height);
  paintInertBlock(
    context,
    layout,
    visibleBlockRange.startIndex,
    visibleBlockRange.endIndex,
    theme,
    width,
  );

  // Stage 4: active table cell band, painted after backgrounds and before
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

  // Stage 5: per-visible-line foreground (text, decorations, markers, effects).
  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    paintContentLine({
      activeBlockId,
      activeBlockFlashes,
      ambientAnimationTime,
      activeTextFades,
      activeTextHighlights,
      activeBlockPulses,
      activeTextPulses,
      activeThreadIndex,
      context,
      editorState,
      line,
      commentRanges,
      normalizedSelection,
      presenceActiveThreadColors,
      resources,
      blockSnapshots,
      selectionRegionOrderRange,
      textDecorations,
      theme,
      width,
    });
  }

  // Stage 6: rules (heading underline, blockquote bar) painted last so they
  // sit on top of any foreground that bled into their geometry.
  paintHeadingRules(context, visibleHeadingRules, theme);
  paintBlockquoteRules(context, visibleBlockquoteRegions, theme);

  context.restore();
}

// Per-line foreground sub-pipeline. Intentionally short and linear — each call
// is a single visual concern, ordered by z-stack.
function paintContentLine({
  activeBlockId,
  activeBlockFlashes,
  ambientAnimationTime,
  activeTextFades,
  activeTextHighlights,
  activeBlockPulses,
  activeTextPulses,
  activeThreadIndex,
  context,
  editorState,
  line,
  commentRanges,
  normalizedSelection,
  presenceActiveThreadColors,
  resources,
  blockSnapshots,
  selectionRegionOrderRange,
  textDecorations,
  theme,
  width,
}: {
  activeBlockId: string | null;
  activeBlockFlashes: Map<string, ActiveBlockFlash>;
  ambientAnimationTime: number;
  activeTextFades: Map<string, ActiveTextFade[]>;
  activeTextHighlights: Map<string, ActiveTextHighlight[]>;
  activeBlockPulses: Map<string, ActiveBlockPulse>;
  activeTextPulses: Map<string, ActiveTextPulse[]>;
  activeThreadIndex: number | null;
  context: CanvasRenderingContext2D;
  editorState: EditorState;
  line: DocumentLayout["lines"][number];
  commentRanges: EditorCommentRange[];
  normalizedSelection: NormalizedEditorSelection;
  presenceActiveThreadColors: ReadonlyMap<number, string | null>;
  resources: DocumentResources;
  blockSnapshots: Map<string, Block>;
  selectionRegionOrderRange: SelectionRegionOrderRange | null;
  textDecorations: TextDecorationIndex;
  theme: EditorTheme;
  width: number;
}) {
  const snapshotBlock = blockSnapshots.get(line.blockId) ?? null;
  const runtimeBlockPath = editorState.documentIndex.blockIndex.get(line.blockId)?.path ?? null;
  const container = editorState.documentIndex.regionIndex.get(line.regionId) ?? null;
  const containerPath = container?.path ?? "";
  const listItemEntry = findAncestorBlockEntry(editorState.documentIndex, line.blockId, "listItem");
  const listMarker = listItemEntry ? resolveListItemMarker(editorState, listItemEntry.id) : null;
  const blockPulse = listItemEntry ? (activeBlockPulses.get(listItemEntry.path) ?? null) : null;
  const textLeft = line.left + resolveLineContentInset(editorState, line);
  const textBaseline = resolveLineTextBaseline(line);
  const defaultTextColor =
    snapshotBlock?.type === "code" ? theme.codeText : resolveTextColor(snapshotBlock, theme);

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
  const lineTextDecorations = textDecorations.size > 0 ? textDecorations.get(containerPath) : null;

  if (lineTextDecorations) {
    paintTextDecorations(
      context,
      line,
      container,
      textLeft,
      textBaseline,
      lineTextDecorations,
      "background",
      ambientAnimationTime,
      defaultTextColor,
    );
  }
  paintSelectionHighlight(
    context,
    editorState,
    line,
    normalizedSelection,
    selectionRegionOrderRange,
    theme,
  );
  paintCommentHighlights(
    context,
    editorState,
    line,
    commentRanges,
    activeThreadIndex,
    presenceActiveThreadColors,
    ambientAnimationTime,
    theme,
  );
  paintListMarker(
    context,
    line,
    listMarker,
    textLeft,
    textBaseline,
    defaultTextColor,
    theme,
    blockPulse,
  );
  paintLineText(
    context,
    line,
    container,
    textLeft,
    textBaseline,
    defaultTextColor,
    resources,
    theme,
    ambientAnimationTime,
  );
  if (lineTextDecorations) {
    paintTextDecorations(
      context,
      line,
      container,
      textLeft,
      textBaseline,
      lineTextDecorations,
      "overlay",
      ambientAnimationTime,
      defaultTextColor,
    );
  }
  paintTextHighlights(
    context,
    line,
    container,
    textLeft,
    textBaseline,
    activeTextHighlights.get(containerPath) ?? [],
    theme,
  );
  paintTextFades(
    context,
    line,
    container,
    textLeft,
    textBaseline,
    activeTextFades.get(containerPath) ?? [],
    defaultTextColor,
  );
  paintTextPulses(
    context,
    line,
    container,
    textLeft,
    textBaseline,
    activeTextPulses.get(containerPath) ?? [],
    theme,
  );
}

function resolveLineTextBaseline(line: DocumentLayout["lines"][number]) {
  return line.top + resolveCenteredTextBaseline(line.height, line.font);
}

function resolveTextColor(block: Block | null, theme: EditorTheme) {
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
  return performance.now();
}
