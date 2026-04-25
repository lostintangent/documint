// Owns pure canvas painting from prepared layout. The layout pass decides
// geometry; this module turns that geometry into pixels with a small amount of
// visual policy around highlights, caret alignment, and inline chrome.

import type { Block, Mark } from "@/document";
import type { EditorCommentRange, EditorPresence } from "../annotations";
import type { EditorState } from "../state";
import type { DocumentResources } from "@/types";
import {
  findBlockAncestor,
  findLineForRegionOffset,
  findVisibleLineRange,
  measureCaretTarget,
  measureLineOffsetLeft,
  resolveCaretVisualLeft,
  resolveLineContentInset,
  resolveLineVisualLeft,
  resolveListItemMarker,
  type ViewportLayout,
} from "../layout";
import { resolveCanvasCenteredTextBaseline, resolveCanvasFontMetrics } from "./font-metrics";
import {
  resolveDeletedTextFadeColor,
  resolveActiveDeletedTextFades,
  resolveActiveInsertedTextHighlights,
  resolveActiveBlockFlashColor,
  resolveActiveBlockFlashes,
  resolveActiveListMarkerPops,
  resolveActivePunctuationPulses,
  resolveActiveInsertedTextHighlightForSegment,
  resolveAnimatedTextColor,
  resolveInsertHighlightSegmentBoundaries,
  resolvePunctuationPulseColor,
  type ActiveDeletedTextFade,
  type ActiveInsertedTextHighlight,
  type ActiveBlockFlash,
  type ActiveListMarkerPop,
  type ActivePunctuationPulse,
} from "./animations";
import { paintInlineImage } from "./image";
import { paintListMarker } from "./list";
import {
  paintActiveTableCellHighlightPass,
  paintTableCellChrome,
  type PaintRegionBounds,
} from "./table";
import type { EditorTheme } from "@/types";

const activeLineVerticalBleed = 2;
const blockquoteRuleInsetY = 3;
const blockquoteRuleMinimumHeight = 12;
const blockquoteRuleTrimY = 6;
const blockquoteRuleWidth = 3;
const caretOpticalTopInset = 1;
const caretStrokeWidth = 2;
const caretVerticalInset = 2;
const codeBlockBackgroundBottomInset = 8;
const codeBlockBackgroundHorizontalInset = 12;
const codeBlockBackgroundMinimumWidthBoost = 28;
const codeBlockBackgroundTopInset = 4;
const commentHighlightBottomInset = 5;
const commentHighlightMinimumWidth = 2;
const commentHighlightThickness = 3;
const inlineCodeBackgroundBottomInset = 6;
const inlineCodeBackgroundHorizontalPadding = 3;
const inlineCodeBackgroundMinimumHeight = 12;
const inlineCodeBackgroundMinimumWidth = 10;
const inlineCodeBackgroundTopInset = 2;
const selectionMinimumWidth = 2;
const selectionVerticalInset = 1;
const selectionVerticalTrim = 2;
const textDecorationMinimumWidth = 2;
const textDecorationThickness = 1.25;
const headingRuleInsetY = 5;
const headingRuleThickness = 1;
const punctuationPulseBaseRadius = 4;
const punctuationPulseRadiusGrowth = 4;
const punctuationPulseStrokeWidth = 1.5;

type CanvasSelectionRange = {
  end: { regionId: string; offset: number };
  start: { regionId: string; offset: number };
};

type RegionOrderRange = {
  end: number;
  start: number;
};

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
  layout: ViewportLayout;
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

  const selectionRegionOrderRange = resolveSelectionRegionOrderRange(
    editorState,
    normalizedSelection,
  );
  const { endIndex, startIndex } = findVisibleLineRange(layout, viewportTop, height);
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

  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    paintCanvasDocumentLineBackground({
      containerLineBounds,
      context,
      editorState,
      line,
      runtimeBlockMap,
      theme,
      width,
    });
  }

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

  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    paintDocumentLineForeground({
      activeBlockId,
      activeBlockFlashes,
      activeDeletedTextFades,
      activeThreadIndex,
      activeInsertedTextHighlights,
      activeListMarkerPops,
      activePunctuationPulses,
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

  paintHeadingRules(context, visibleHeadingRules, theme);
  paintBlockquoteRules(context, visibleBlockquoteRegions, theme);

  context.restore();
}

function resolveSelectionRegionOrderRange(
  editorState: EditorState,
  normalizedSelection: CanvasSelectionRange,
): RegionOrderRange | null {
  const regionOrderIndex = editorState.documentIndex.regionOrderIndex;
  const start = regionOrderIndex.get(normalizedSelection.start.regionId);
  const end = regionOrderIndex.get(normalizedSelection.end.regionId);

  return start === undefined || end === undefined ? null : { end, start };
}

function resolveVisibleHeadingRules(
  layout: ViewportLayout,
  editorState: EditorState,
  runtimeBlockMap: Map<string, Block>,
  startIndex: number,
  endIndex: number,
  width: number,
) {
  const rules = new Map<string, { bottom: number; left: number; right: number }>();

  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    const block = runtimeBlockMap.get(line.blockId);

    if (block?.type !== "heading" || (block.depth !== 1 && block.depth !== 2)) {
      continue;
    }

    const current = rules.get(block.id);
    const next = {
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

function resolveVisibleBlockquoteRegions(
  layout: ViewportLayout,
  editorState: EditorState,
  activeBlockId: string | null,
  startIndex: number,
  endIndex: number,
) {
  const regions = new Map<
    string,
    { bottom: number; isActive: boolean; left: number; top: number }
  >();

  for (let index = startIndex; index < endIndex; index += 1) {
    const line = layout.lines[index]!;
    const blockquoteEntry = findBlockAncestor(editorState, line.blockId, "blockquote");

    if (!blockquoteEntry) {
      continue;
    }

    const current = regions.get(blockquoteEntry.id);
    const next = {
      bottom: line.top + line.height,
      isActive: line.blockId === activeBlockId,
      left: layout.options.paddingX + (blockquoteEntry.depth + 1) * layout.options.indentWidth - 10,
      top: line.top,
    };

    regions.set(
      blockquoteEntry.id,
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

function paintHeadingRules(
  context: CanvasRenderingContext2D,
  visibleHeadingRules: Map<string, { bottom: number; left: number; right: number }>,
  theme: EditorTheme,
) {
  context.fillStyle = theme.headingRule;

  for (const rule of visibleHeadingRules.values()) {
    context.fillRect(
      rule.left,
      rule.bottom + headingRuleInsetY,
      Math.max(textDecorationMinimumWidth, rule.right - rule.left),
      headingRuleThickness,
    );
  }
}

function paintBlockquoteRules(
  context: CanvasRenderingContext2D,
  visibleBlockquoteRegions: Map<
    string,
    { bottom: number; isActive: boolean; left: number; top: number }
  >,
  theme: EditorTheme,
) {
  for (const region of visibleBlockquoteRegions.values()) {
    context.fillStyle = region.isActive ? theme.blockquoteRuleActive : theme.blockquoteRule;
    context.fillRect(
      region.left,
      region.top + blockquoteRuleInsetY,
      blockquoteRuleWidth,
      Math.max(blockquoteRuleMinimumHeight, region.bottom - region.top - blockquoteRuleTrimY),
    );
  }
}

export function paintCanvasCaretOverlay({
  context,
  devicePixelRatio,
  editorState,
  height,
  layout,
  normalizedSelection,
  presence,
  showCaret,
  theme,
  viewportTop,
  width,
}: {
  context: CanvasRenderingContext2D;
  devicePixelRatio: number;
  editorState: EditorState;
  height: number;
  layout: ViewportLayout;
  normalizedSelection: CanvasSelectionRange;
  presence?: EditorPresence[];
  showCaret: boolean;
  theme: EditorTheme;
  viewportTop: number;
  width: number;
}) {
  context.save();
  context.scale(devicePixelRatio, devicePixelRatio);
  context.clearRect(0, 0, width, height);

  const hasRangeSelection =
    normalizedSelection.start.regionId === normalizedSelection.end.regionId &&
    normalizedSelection.start.offset !== normalizedSelection.end.offset;
  const shouldPaintUserCaret = showCaret && !hasRangeSelection;

  context.translate(0, -viewportTop);

  if (shouldPaintUserCaret) {
    paintCanvasCaret(context, editorState, layout, {
      color: theme.caret,
      offset: editorState.selection.focus.offset,
      regionId: editorState.selection.focus.regionId,
    });
  }

  if (presence) {
    for (const presenceItem of presence) {
      if (!presenceItem.cursorPoint) {
        continue;
      }

      paintCanvasCaret(context, editorState, layout, {
        color: presenceItem.color ?? theme.leafAccent,
        offset: presenceItem.cursorPoint.offset,
        regionId: presenceItem.cursorPoint.regionId,
      });
    }
  }

  context.restore();
}

function paintCanvasCaret(
  context: CanvasRenderingContext2D,
  editorState: EditorState,
  layout: ViewportLayout,
  target: {
    color: string;
    offset: number;
    regionId: string;
  },
) {
  const caret = measureCaretTarget(layout, editorState.documentIndex, {
    regionId: target.regionId,
    offset: target.offset,
  });

  if (!caret) {
    return;
  }

  const caretLeft = resolveCaretVisualLeft(editorState, layout, caret);
  const metrics = resolveCanvasCaretPaintMetrics(layout, caret);

  context.fillStyle = target.color;
  context.fillRect(caretLeft, metrics.top, caretStrokeWidth, metrics.height);
}

function paintCanvasDocumentLineBackground({
  containerLineBounds,
  context,
  editorState,
  line,
  runtimeBlockMap,
  theme,
  width,
}: {
  containerLineBounds: Map<string, PaintRegionBounds>;
  context: CanvasRenderingContext2D;
  editorState: EditorState;
  line: ViewportLayout["lines"][number];
  runtimeBlockMap: Map<string, Block>;
  theme: EditorTheme;
  width: number;
}) {
  const snapshotBlock = runtimeBlockMap.get(line.blockId) ?? null;
  const containerBounds = containerLineBounds.get(line.regionId) ?? null;
  const tableCellPosition = editorState.documentIndex.tableCellIndex.get(line.regionId) ?? null;

  paintCanvasLineContainerBackground(
    context,
    line,
    snapshotBlock,
    containerBounds,
    tableCellPosition,
    theme,
    width,
  );
}

function paintDocumentLineForeground({
  activeBlockId,
  activeBlockFlashes,
  activeDeletedTextFades,
  activeThreadIndex,
  activeInsertedTextHighlights,
  activeListMarkerPops,
  activePunctuationPulses,
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
  activeThreadIndex: number | null;
  activeInsertedTextHighlights: Map<string, ActiveInsertedTextHighlight[]>;
  activeListMarkerPops: Map<string, ActiveListMarkerPop>;
  activePunctuationPulses: Map<string, ActivePunctuationPulse[]>;
  context: CanvasRenderingContext2D;
  editorState: EditorState;
  line: ViewportLayout["lines"][number];
  liveCommentRanges: EditorCommentRange[];
  normalizedSelection: CanvasSelectionRange;
  resources: DocumentResources;
  runtimeBlockMap: Map<string, Block>;
  selectionRegionOrderRange: RegionOrderRange | null;
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

function paintCanvasLineContainerBackground(
  context: CanvasRenderingContext2D,
  line: ViewportLayout["lines"][number],
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

function paintActiveBlockBackground(
  context: CanvasRenderingContext2D,
  line: ViewportLayout["lines"][number],
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

function paintSelectionHighlight(
  context: CanvasRenderingContext2D,
  editorState: EditorState,
  line: ViewportLayout["lines"][number],
  normalizedSelection: CanvasSelectionRange,
  selectionRegionOrderRange: RegionOrderRange | null,
  theme: EditorTheme,
) {
  if (!selectionRegionOrderRange) {
    return;
  }

  const lineRegionOrder = editorState.documentIndex.regionOrderIndex.get(line.regionId);

  if (
    lineRegionOrder === undefined ||
    lineRegionOrder < selectionRegionOrderRange.start ||
    lineRegionOrder > selectionRegionOrderRange.end
  ) {
    return;
  }

  const overlapStart =
    lineRegionOrder === selectionRegionOrderRange.start
      ? Math.max(line.start, normalizedSelection.start.offset)
      : line.start;
  const overlapEnd =
    lineRegionOrder === selectionRegionOrderRange.end
      ? Math.min(line.end, normalizedSelection.end.offset)
      : line.end;

  if (overlapEnd <= overlapStart) {
    return;
  }

  context.fillStyle = theme.selectionBackground;
  context.fillRect(
    resolveLineVisualLeft(editorState, line, overlapStart - line.start),
    line.top + selectionVerticalInset,
    Math.max(
      selectionMinimumWidth,
      resolveLineVisualLeft(editorState, line, overlapEnd - line.start) -
        resolveLineVisualLeft(editorState, line, overlapStart - line.start),
    ),
    line.height - selectionVerticalTrim,
  );
}

function paintCanvasCommentHighlights(
  context: CanvasRenderingContext2D,
  editorState: EditorState,
  line: ViewportLayout["lines"][number],
  liveCommentRanges: EditorCommentRange[],
  activeThreadIndex: number | null,
  theme: EditorTheme,
) {
  for (const range of liveCommentRanges) {
    if (range.regionId !== line.regionId) {
      continue;
    }

    const overlapStart = Math.max(range.startOffset, line.start);
    const overlapEnd = Math.min(range.endOffset, line.end);

    if (overlapEnd <= overlapStart) {
      continue;
    }

    context.fillStyle = resolveCommentHighlightColor(range, activeThreadIndex, theme);
    context.fillRect(
      resolveLineVisualLeft(editorState, line, overlapStart - line.start),
      line.top + line.height - commentHighlightBottomInset,
      Math.max(
        commentHighlightMinimumWidth,
        resolveLineVisualLeft(editorState, line, overlapEnd - line.start) -
          resolveLineVisualLeft(editorState, line, overlapStart - line.start),
      ),
      commentHighlightThickness,
    );
  }
}

function paintCanvasLineText(
  context: CanvasRenderingContext2D,
  line: ViewportLayout["lines"][number],
  container: EditorState["documentIndex"]["regions"][number] | null,
  textLeft: number,
  textBaseline: number,
  insertedTextHighlights: ActiveInsertedTextHighlight[],
  defaultColor: string,
  resources: DocumentResources,
  theme: EditorTheme,
) {
  if (!container) {
    context.fillStyle = defaultColor;
    context.fillText(line.text, textLeft, textBaseline);
    return;
  }

  const visibleRuns = container.inlines.filter(
    (run) => run.end > line.start && run.start < line.end,
  );

  if (visibleRuns.length === 0) {
    context.fillStyle = defaultColor;
    context.fillText(line.text, textLeft, textBaseline);
    return;
  }

  for (const run of visibleRuns) {
    const start = Math.max(line.start, run.start);
    const end = Math.min(line.end, run.end);
    const segmentText = container.text.slice(start, end);

    if (segmentText.length === 0) {
      continue;
    }

    const { left: segmentLeft, right: segmentRight } = resolveLineSegmentBounds(
      line,
      textLeft,
      start,
      end,
    );
    const runFont = resolveCanvasInlineFont(line.font, run.marks);
    context.font = runFont;

    if (run.kind === "image") {
      const imageWidth = Math.max(24, segmentRight - segmentLeft);
      paintInlineImage(context, line, run, resources, theme, segmentLeft, imageWidth);
      continue;
    }

    if (run.kind === "inlineCode") {
      const inlineCodeTop = resolveCanvasInlineCodeBackgroundTop(line, runFont);
      const inlineCodeHeight = resolveCanvasInlineCodeBackgroundHeight(line, runFont);

      context.fillStyle = theme.inlineCodeBackground;
      context.fillRect(
        segmentLeft - inlineCodeBackgroundHorizontalPadding,
        inlineCodeTop,
        Math.max(
          inlineCodeBackgroundMinimumWidth,
          segmentRight - segmentLeft + inlineCodeBackgroundHorizontalPadding * 2,
        ),
        inlineCodeHeight,
      );
      paintTextRunSegments(
        context,
        line,
        container.text,
        textLeft,
        textBaseline,
        start,
        end,
        theme.inlineCodeText,
        insertedTextHighlights,
        theme,
        {
          strikethrough: false,
          underline: false,
        },
      );
      continue;
    }

    paintTextRunSegments(
      context,
      line,
      container.text,
      textLeft,
      textBaseline,
      start,
      end,
      run.link ? theme.linkText : defaultColor,
      insertedTextHighlights,
      theme,
      {
        strikethrough: run.marks.includes("strikethrough"),
        underline: run.marks.includes("underline") || Boolean(run.link),
      },
    );
  }
}

function paintTextRunSegments(
  context: CanvasRenderingContext2D,
  line: ViewportLayout["lines"][number],
  containerText: string,
  textLeft: number,
  textBaseline: number,
  startOffset: number,
  endOffset: number,
  baseColor: string,
  insertedTextHighlights: ActiveInsertedTextHighlight[],
  theme: EditorTheme,
  decorations: {
    strikethrough: boolean;
    underline: boolean;
  },
) {
  const segmentBoundaries = resolveInsertHighlightSegmentBoundaries(
    startOffset,
    endOffset,
    insertedTextHighlights,
  );

  for (let index = 0; index < segmentBoundaries.length - 1; index += 1) {
    const segmentStart = segmentBoundaries[index]!;
    const segmentEnd = segmentBoundaries[index + 1]!;

    if (segmentEnd <= segmentStart) {
      continue;
    }

    const segmentText = containerText.slice(segmentStart, segmentEnd);

    if (segmentText.length === 0) {
      continue;
    }

    const { left: segmentLeft, right: segmentRight } = resolveLineSegmentBounds(
      line,
      textLeft,
      segmentStart,
      segmentEnd,
    );
    const activeHighlight = resolveActiveInsertedTextHighlightForSegment(
      insertedTextHighlights,
      segmentStart,
      segmentEnd,
    );
    const textColor = resolveAnimatedTextColor(baseColor, activeHighlight, theme);

    context.fillStyle = textColor;
    context.fillText(segmentText, segmentLeft, textBaseline);

    if (decorations.strikethrough) {
      context.fillRect(
        segmentLeft,
        resolveStrikethroughTop(textBaseline, line.height, context.font),
        Math.max(textDecorationMinimumWidth, segmentRight - segmentLeft),
        textDecorationThickness,
      );
    }

    if (decorations.underline) {
      context.fillRect(
        segmentLeft,
        resolveCanvasTextDecorationTop(textBaseline, line.height, context.font),
        Math.max(textDecorationMinimumWidth, segmentRight - segmentLeft),
        textDecorationThickness,
      );
    }
  }
}

function paintCanvasDeletedTextFades(
  context: CanvasRenderingContext2D,
  line: ViewportLayout["lines"][number],
  container: EditorState["documentIndex"]["regions"][number] | null,
  textLeft: number,
  textBaseline: number,
  deletedTextFades: ActiveDeletedTextFade[],
  baseColor: string,
) {
  if (!container || deletedTextFades.length === 0) {
    return;
  }

  for (const fade of deletedTextFades) {
    if (fade.startOffset < line.start || fade.startOffset > line.end) {
      continue;
    }

    const ghostLeft =
      textLeft + (measureLineOffsetLeft(line, fade.startOffset - line.start) - line.left);

    context.fillStyle = resolveDeletedTextFadeColor(baseColor, fade);
    context.fillText(fade.text, ghostLeft, textBaseline);
  }
}

function paintCanvasPunctuationPulses(
  context: CanvasRenderingContext2D,
  line: ViewportLayout["lines"][number],
  container: EditorState["documentIndex"]["regions"][number] | null,
  textLeft: number,
  textBaseline: number,
  punctuationPulses: ActivePunctuationPulse[],
  theme: EditorTheme,
) {
  if (!container || punctuationPulses.length === 0) {
    return;
  }

  for (const pulse of punctuationPulses) {
    if (pulse.offset < line.start || pulse.offset >= line.end) {
      continue;
    }

    const { left, right } = resolveLineSegmentBounds(
      line,
      textLeft,
      pulse.offset,
      pulse.offset + 1,
    );
    const radius = Math.max(
      punctuationPulseBaseRadius,
      (right - left) / 2 +
        punctuationPulseBaseRadius +
        punctuationPulseRadiusGrowth * pulse.progress,
    );
    const { ascent, descent } = resolveCanvasFontMetrics(line.font);
    const glyphCenterY = textBaseline - Math.max(1, ascent * 0.42) + Math.max(0.5, descent * 0.15);

    context.strokeStyle = resolvePunctuationPulseColor(pulse, theme);
    context.lineWidth = punctuationPulseStrokeWidth;
    context.beginPath();
    context.arc((left + right) / 2, glyphCenterY, radius, 0, Math.PI * 2);
    context.stroke();
  }
}

function resolveCanvasCaretPaintMetrics(
  layout: ViewportLayout,
  caret: NonNullable<ReturnType<typeof measureCaretTarget>>,
) {
  const line = findLineForRegionOffset(layout, caret.regionId, caret.offset);
  const font = line?.font ?? '16px "Iowan Old Style", "Palatino Linotype", serif';
  const { ascent, descent } = resolveCanvasFontMetrics(font);
  const glyphHeight = Math.max(1, ascent + descent);
  const height = Math.min(caret.height - caretVerticalInset, glyphHeight);
  const top = line
    ? Math.max(
        line.top,
        line.top + resolveCanvasLineTextTop(line.height, font) - caretOpticalTopInset,
      )
    : caret.top + Math.max(0, Math.floor((caret.height - height) / 2));

  return {
    height,
    top,
  };
}

function resolveCanvasTextDecorationTop(textBaseline: number, lineHeight: number, font: string) {
  const { descent } = resolveCanvasFontMetrics(font);
  const descentInset = Math.max(1, Math.round(Math.max(2, descent) * 0.35));
  const glyphBottom = textBaseline + descent - descentInset;
  const lineTop = textBaseline - resolveCanvasLineTextBaselineOffset(lineHeight, font);

  return Math.min(lineTop + lineHeight - 4, glyphBottom);
}

function resolveStrikethroughTop(textBaseline: number, lineHeight: number, font: string) {
  const { ascent } = resolveCanvasFontMetrics(font);
  const lineTop = textBaseline - resolveCanvasLineTextBaselineOffset(lineHeight, font);

  return Math.max(lineTop + 2, textBaseline - Math.round(ascent * 0.32));
}

function resolveCanvasLineTextBaseline(line: ViewportLayout["lines"][number]) {
  return line.top + resolveCanvasLineTextBaselineOffset(line.height, line.font);
}

function resolveCanvasLineTextBaselineOffset(lineHeight: number, font: string) {
  return resolveCanvasCenteredTextBaseline(lineHeight, font);
}

function resolveCanvasInlineCodeBackgroundTop(line: ViewportLayout["lines"][number], font: string) {
  const lineTextTop = resolveCanvasLineTextTop(line.height, font);

  return line.top + lineTextTop + inlineCodeBackgroundTopInset;
}

function resolveCanvasInlineCodeBackgroundHeight(
  line: ViewportLayout["lines"][number],
  font: string,
) {
  const lineTextTop = resolveCanvasLineTextTop(line.height, font);

  return Math.max(
    inlineCodeBackgroundMinimumHeight,
    line.height - lineTextTop - inlineCodeBackgroundBottomInset,
  );
}

function resolveCanvasLineTextTop(lineHeight: number, font: string) {
  const { ascent } = resolveCanvasFontMetrics(font);

  return resolveCanvasLineTextBaselineOffset(lineHeight, font) - ascent;
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

function resolveLineSegmentBounds(
  line: ViewportLayout["lines"][number],
  textLeft: number,
  startOffset: number,
  endOffset: number,
) {
  return {
    left: textLeft + (measureLineOffsetLeft(line, startOffset - line.start) - line.left),
    right: textLeft + (measureLineOffsetLeft(line, endOffset - line.start) - line.left),
  };
}

function resolveCanvasInlineFont(font: string, marks: Mark[]) {
  const parts: string[] = [];

  if (marks.includes("italic")) {
    parts.push("italic");
  }

  if (marks.includes("bold")) {
    parts.push("700");
  }

  return parts.length > 0 ? `${parts.join(" ")} ${font}` : font;
}

function resolveCommentHighlightColor(
  range: EditorCommentRange,
  activeThreadIndex: number | null,
  theme: EditorTheme,
) {
  if (range.resolved) {
    return range.threadIndex === activeThreadIndex
      ? theme.commentHighlightResolvedActive
      : theme.commentHighlightResolved;
  }

  return range.threadIndex === activeThreadIndex
    ? theme.commentHighlightActive
    : theme.commentHighlight;
}

function getPaintTime() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/* Viewport-level paint wrappers */

import type { EditorViewportState } from "../layout";
import type { NormalizedEditorSelection } from "../state";

export function paintContent(
  state: EditorState,
  viewport: EditorViewportState,
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

export function paintOverlay(
  state: EditorState,
  viewport: EditorViewportState,
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
