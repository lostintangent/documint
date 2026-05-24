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
} from "@/editor/layout";
import { type EditorState, type NormalizedEditorSelection } from "@/editor/state";
import type { DocumentResources, ResolvedEditorTheme } from "@/types";
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
  paintActiveBlockBackground,
  paintActiveBlockHighlight,
  paintBlockquoteRules,
  paintLineContainerBackground,
  paintHeadingRules,
  paintInertBlock,
  resolveVisibleBlockquoteRegions,
  resolveVisibleHeadingRules,
} from "./painters/blocks";
import { paintCaretOverlay } from "./painters/caret";
import { paintCommentHighlights } from "./painters/comments";
import {
  paintListMarker,
  resolveVisibleListMarkers,
  type VisibleListMarker,
} from "./painters/list";
import {
  paintSelectionHighlight,
  resolveSelectionRegionOrderRange,
  type SelectionRegionOrderRange,
} from "./painters/selection";
import {
  paintTextFades,
  paintTextHighlights,
  paintLineText,
  paintTextPulses,
  paintTextDecorationBackgrounds,
  paintTextDecorationOverlays,
} from "./painters/text";

const emptyTextDecorationIndex: TextDecorationIndex = new Map();
const emptyCommentPresence: ReadonlyMap<number, EditorPresence> = new Map();
const emptyResources: DocumentResources = { images: new Map() };

type PaintLayerOptions = {
  devicePixelRatio: number;
  height: number;
  normalizedSelection: NormalizedEditorSelection;
  theme: ResolvedEditorTheme;
  width: number;
};

export type PaintContentOptions = PaintLayerOptions & {
  activeBlockId: string | null;
  activeRegionId: string | null;
  activeThreadIndex: number | null;
  // `now` is required: pixels are a function of inputs, and that includes
  // time. Animation progress, ambient pulses, and the default for
  // `ambientAnimationTime` all resolve through it. Callers that don't care
  // about animations should pass `0` (or any fixed value) for determinism.
  now: number;
  // Ambient effects (caret blink, resting pulses) resolve from this clock,
  // which the host may freeze/resume around activity to keep effects in
  // phase. Defaults to `now` when omitted.
  ambientAnimationTime?: number;
  commentRanges: EditorCommentRange[];
  commentPresence?: ReadonlyMap<number, EditorPresence>;
  resources?: DocumentResources | null;
  textDecorations?: TextDecorationIndex;
};

export type PaintOverlayOptions = PaintLayerOptions & {
  presence?: EditorPresence[];
  showCaret: boolean;
};

// Renderer entry point for the content canvas. Owns the staging order;
// delegates each stage's work to a sibling module.
export function paintContent(
  state: EditorState,
  viewport: EditorLayoutState,
  context: CanvasRenderingContext2D,
  options: PaintContentOptions,
): void {
  const {
    activeBlockId,
    activeRegionId,
    activeThreadIndex,
    ambientAnimationTime = options.now,
    commentRanges,
    commentPresence = emptyCommentPresence,
    devicePixelRatio,
    height,
    normalizedSelection,
    now,
    resources: resourcesOption,
    textDecorations = emptyTextDecorationIndex,
    theme,
    width,
  } = options;
  const resources = resourcesOption ?? emptyResources;
  const { layout, blockMap: blockSnapshots, paintTop: viewportTop } = viewport;

  context.save();
  context.scale(devicePixelRatio, devicePixelRatio);
  context.clearRect(0, 0, width, height);
  context.fillStyle = theme.background;
  context.fillRect(0, 0, width, height);
  context.textBaseline = "alphabetic";
  context.translate(0, -viewportTop);

  // Stage 1: per-frame derivations that are stable across the per-line passes.
  const { endIndex, startIndex } = findVisibleLineRange(layout, viewportTop, height);
  const selectionRegionOrderRange = resolveSelectionRegionOrderRange(state, normalizedSelection);
  const activeBlockFlashes = resolveActiveBlockFlashes(state, now);
  const activeTextFades = resolveActiveTextFades(state, now);
  const activeTextHighlights = resolveActiveTextHighlights(state, now);
  const activeBlockPulses = resolveActiveBlockPulses(state, now);
  const activeTextPulses = resolveActiveTextPulses(state, now);
  const visibleBlockquoteRegions = resolveVisibleBlockquoteRegions(
    layout,
    state,
    activeBlockId,
    startIndex,
    endIndex,
  );
  const visibleHeadingRules = resolveVisibleHeadingRules(
    layout,
    state,
    blockSnapshots,
    startIndex,
    endIndex,
    width,
  );
  const visibleListMarkers = resolveVisibleListMarkers(layout, state, startIndex, endIndex);

  // Inputs to the per-line foreground stage. Built once per frame — per-line
  // work only varies `line`, so we don't reallocate an options bag per
  // visible line.
  const lineInputs: LineForegroundInputs = {
    activeBlockFlashes,
    activeBlockId,
    activeBlockPulses,
    activeTextFades,
    activeTextHighlights,
    activeTextPulses,
    activeThreadIndex,
    ambientAnimationTime,
    blockSnapshots,
    commentPresence,
    commentRanges,
    context,
    editorState: state,
    layout,
    normalizedSelection,
    resources,
    selectionRegionOrderRange,
    textDecorations,
    theme,
    visibleListMarkers,
    width,
  };

  // Stage 2: per-visible-line block backgrounds (code fences, table cell chrome).
  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    paintLineContainerBackground(
      context,
      line,
      blockSnapshots.get(line.blockId) ?? null,
      layout.regionBounds.get(line.regionId) ?? null,
      state.documentIndex.regionIndex.get(line.regionId)?.tableCellPosition ?? null,
      theme,
      layout,
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

  // Stage 4: active block highlight, painted after backgrounds and before
  // foregrounds. The dispatcher in `blocks/backgrounds.ts` decides which
  // block-type-specific chrome to paint (today: active table cell band).
  paintActiveBlockHighlight({
    activeBlockFlashes,
    activeBlockId,
    activeRegionId,
    context,
    editorState: state,
    endIndex,
    layout,
    regionBounds: layout.regionBounds,
    startIndex,
    theme,
  });

  // Stage 5: per-visible-line foreground (text, decorations, markers, effects).
  for (let index = startIndex; index < endIndex; index += 1) {
    paintContentLine(lineInputs, layout.lines[index]!);
  }

  // Stage 6: rules (heading underline, blockquote bar) painted last so they
  // sit on top of any foreground that bled into their geometry.
  paintHeadingRules(context, visibleHeadingRules, theme);
  paintBlockquoteRules(context, visibleBlockquoteRegions, theme);

  context.restore();
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

// Inputs to the per-line foreground stage. Stable across the line loop and
// built once per frame in `paintContent`; `paintContentLine` only varies
// `line`. Naming mirrors the "per-line foreground sub-pipeline" comment on
// `paintContentLine`.
type LineForegroundInputs = {
  activeBlockFlashes: Map<string, ActiveBlockFlash>;
  activeBlockId: string | null;
  activeBlockPulses: Map<string, ActiveBlockPulse>;
  activeTextFades: Map<string, ActiveTextFade[]>;
  activeTextHighlights: Map<string, ActiveTextHighlight[]>;
  activeTextPulses: Map<string, ActiveTextPulse[]>;
  activeThreadIndex: number | null;
  ambientAnimationTime: number;
  blockSnapshots: Map<string, Block>;
  commentPresence: ReadonlyMap<number, EditorPresence>;
  commentRanges: EditorCommentRange[];
  context: CanvasRenderingContext2D;
  editorState: EditorState;
  layout: EditorLayoutState["layout"];
  normalizedSelection: NormalizedEditorSelection;
  resources: DocumentResources;
  selectionRegionOrderRange: SelectionRegionOrderRange | null;
  textDecorations: TextDecorationIndex;
  theme: ResolvedEditorTheme;
  visibleListMarkers: Map<string, VisibleListMarker>;
  width: number;
};

// Per-line foreground sub-pipeline. Intentionally short and linear — each call
// is a single visual concern, ordered by z-stack.
function paintContentLine(
  inputs: LineForegroundInputs,
  line: EditorLayoutState["layout"]["lines"][number],
) {
  const { context, editorState, theme, width } = inputs;
  const snapshotBlock = inputs.blockSnapshots.get(line.blockId) ?? null;
  const runtimeBlockPath = editorState.documentIndex.blockIndex.get(line.blockId)?.path ?? null;
  const container = editorState.documentIndex.regionIndex.get(line.regionId) ?? null;
  const containerPath = container?.path ?? "";
  const visibleListMarker = inputs.visibleListMarkers.get(line.blockId) ?? null;
  const blockPulse = visibleListMarker
    ? (inputs.activeBlockPulses.get(visibleListMarker.blockPath) ?? null)
    : null;
  const textLeft = line.left + resolveLineContentInset(editorState, line);
  const textBaseline = resolveLineTextBaseline(line);
  const defaultTextColor =
    snapshotBlock?.type === "code" ? theme.codeText : resolveTextColor(snapshotBlock, theme);

  context.font = line.font;

  paintActiveBlockBackground(
    context,
    line,
    snapshotBlock,
    inputs.layout.regionBounds.get(line.regionId) ?? null,
    runtimeBlockPath,
    inputs.activeBlockId,
    inputs.activeBlockFlashes,
    theme,
    inputs.layout,
    width,
  );

  const lineTextDecorations = inputs.textDecorations.get(containerPath) ?? null;

  if (lineTextDecorations) {
    paintTextDecorationBackgrounds(
      context,
      line,
      container,
      textLeft,
      textBaseline,
      lineTextDecorations,
      inputs.ambientAnimationTime,
    );
  }
  paintSelectionHighlight(
    context,
    editorState,
    line,
    inputs.normalizedSelection,
    inputs.selectionRegionOrderRange,
    theme,
  );
  paintCommentHighlights(
    context,
    editorState,
    line,
    inputs.commentRanges,
    inputs.activeThreadIndex,
    inputs.commentPresence,
    inputs.ambientAnimationTime,
    theme,
  );
  paintListMarker(
    context,
    line,
    visibleListMarker?.marker ?? null,
    textLeft,
    textBaseline,
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
    inputs.resources,
    theme,
    inputs.ambientAnimationTime,
  );
  if (lineTextDecorations) {
    paintTextDecorationOverlays(
      context,
      line,
      container,
      textLeft,
      textBaseline,
      lineTextDecorations,
      inputs.ambientAnimationTime,
      defaultTextColor,
    );
  }
  paintTextHighlights(
    context,
    line,
    container,
    textLeft,
    textBaseline,
    inputs.activeTextHighlights.get(containerPath) ?? [],
    theme,
  );
  paintTextFades(
    context,
    line,
    container,
    textLeft,
    textBaseline,
    inputs.activeTextFades.get(containerPath) ?? [],
    defaultTextColor,
  );
  paintTextPulses(
    context,
    line,
    container,
    textLeft,
    textBaseline,
    inputs.activeTextPulses.get(containerPath) ?? [],
    theme,
  );
}

function resolveLineTextBaseline(line: EditorLayoutState["layout"]["lines"][number]) {
  return line.top + resolveCenteredTextBaseline(line.height, line.font);
}

function resolveTextColor(block: Block | null, theme: ResolvedEditorTheme) {
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
