import { findDocumentChanges } from "@/document";
import type { EditorPresence } from "@/editor/anchors";
import { createEditorLayoutState } from "@/editor/layout";
import {
  normalizeSelection,
  resolveIndexedBlockContainingPath,
  type EditorState,
} from "@/editor/state";
import { lightTheme, resolveEditorTheme } from "@/component/lib/themes";
import { parseDocument } from "@/markdown";
import {
  createDocumentFrame,
  createOverlayFrame,
  paintDocumentFrame,
  paintOverlayFrame,
  type DocumentFrame,
  type OverlayFrame,
  type RendererEffect,
} from "@/renderer";

// Shared test harness for renderer tests. Frame builders lay out a state with
// deterministic defaults, and `paint` draws a frame into a recording context
// that captures every fill/stroke/text call as a typed operation so tests can
// assert against the recorded sequence.

export const resolvedLightTheme = resolveEditorTheme(lightTheme);

/** A renderer effect, or an editor effect that has not been given a start time yet. */
export type ScheduledTestEffect =
  | RendererEffect
  | {
      [TKind in RendererEffect["kind"]]: Omit<
        Extract<RendererEffect, { kind: TKind }>,
        "startedAt"
      >;
    }[RendererEffect["kind"]];

type TestDocumentFrameOptions = Partial<
  Omit<Parameters<typeof createDocumentFrame>[2], "effects">
> & {
  effects?: readonly ScheduledTestEffect[];
  metadataExpanded?: boolean;
  top?: number;
};

/**
 * Lay out `state` scrolled to `top` (0 by default) and resolve its document
 * frame. The active block and path follow the selection focus, and `now`
 * defaults to 0 so any state without timed effects paints identically across
 * runs. Effects without a start time start at `now`.
 */
export function createTestDocumentFrame(
  state: EditorState,
  {
    effects,
    height = 420,
    metadataExpanded = false,
    now = 0,
    resources,
    theme = resolvedLightTheme,
    top = 0,
    width = 420,
    ...options
  }: TestDocumentFrameOptions = {},
) {
  const layoutState = createEditorLayoutState(
    state,
    { fontSize: theme.fontSize, height, metadataExpanded, top, width },
    undefined,
    resources,
  );
  const frame = createDocumentFrame(state, layoutState, {
    activeBlockPath:
      resolveIndexedBlockContainingPath(state.documentIndex, state.selection.focus.path)?.path ??
      null,
    activePath: state.selection.focus.path,
    activeThreadIndex: null,
    commentRanges: [],
    devicePixelRatio: 1,
    normalizedSelection: normalizeSelection(state),
    ...options,
    effects: effects?.map((effect) =>
      "startedAt" in effect ? effect : ({ ...effect, startedAt: now } as RendererEffect),
    ),
    height,
    now,
    resources,
    theme,
    width,
  });

  return { frame, layout: layoutState.layout };
}

/** Lay out `state` and resolve its overlay frame with the local caret shown. */
export function createTestOverlayFrame(
  state: EditorState,
  {
    height = 180,
    presence = [],
    width = 420,
  }: { height?: number; presence?: EditorPresence[]; width?: number } = {},
): OverlayFrame {
  const layoutState = createEditorLayoutState(state, { height, top: 0, width });

  return createOverlayFrame(state, layoutState, {
    devicePixelRatio: 1,
    height,
    normalizedSelection: normalizeSelection(state),
    presence,
    showCaret: true,
    theme: resolvedLightTheme,
    width,
  });
}

/** Paint a document or overlay frame into a fresh recording context. */
export function paint(frame: DocumentFrame | OverlayFrame): RecordingCanvasContext {
  const context = new RecordingCanvasContext();
  const canvas = context as unknown as CanvasRenderingContext2D;

  if ("carets" in frame) {
    paintOverlayFrame(canvas, frame);
  } else {
    paintDocumentFrame(canvas, frame);
  }

  return context;
}

type RecordedPathCommand = {
  kind: "lineTo" | "moveTo";
  x: number;
  y: number;
};

export type RecordingOperation =
  | {
      kind: "fillRect";
      fillStyle: string | CanvasGradient | CanvasPattern;
      globalAlpha: number;
      height: number;
      width: number;
      x: number;
      y: number;
    }
  | {
      endAngle: number;
      kind: "arc";
      radius: number;
      startAngle: number;
      x: number;
      y: number;
    }
  | {
      fillStyle: string | CanvasGradient | CanvasPattern;
      globalAlpha: number;
      kind: "fillPath";
    }
  | {
      font: string;
      fillStyle: string | CanvasGradient | CanvasPattern;
      globalCompositeOperation: GlobalCompositeOperation;
      globalAlpha: number;
      kind: "fillText";
      text: string;
      textAlign: CanvasTextAlign;
      x: number;
      y: number;
    }
  | {
      kind: "strokeRect";
      strokeStyle: string | CanvasGradient | CanvasPattern;
      height: number;
      width: number;
      x: number;
      y: number;
    }
  | {
      kind: "strokePath";
      lineWidth: number;
      path: readonly RecordedPathCommand[];
      strokeStyle: string | CanvasGradient | CanvasPattern;
    };

export class RecordingCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  font = "";
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = "source-over";
  lineWidth = 1;
  operations: RecordingOperation[] = [];
  private pendingPath: RecordedPathCommand[] = [];
  private pendingRoundedRect: { height: number; width: number; x: number; y: number } | null = null;
  private stateStack: Array<{
    fillStyle: string | CanvasGradient | CanvasPattern;
    font: string;
    globalAlpha: number;
    globalCompositeOperation: GlobalCompositeOperation;
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
    lineWidth: number;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
  }> = [];
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
    this.operations.push({
      endAngle,
      kind: "arc",
      radius,
      startAngle,
      x,
      y,
    });
  }

  beginPath() {
    this.pendingPath = [];
    this.pendingRoundedRect = null;
  }

  clearRect() {}

  clip() {}

  createLinearGradient(): CanvasGradient {
    return {
      addColorStop() {},
    } as CanvasGradient;
  }

  fill() {
    if (!this.pendingRoundedRect) {
      this.operations.push({
        fillStyle: this.fillStyle,
        globalAlpha: this.globalAlpha,
        kind: "fillPath",
      });
      return;
    }

    this.fillRect(
      this.pendingRoundedRect.x,
      this.pendingRoundedRect.y,
      this.pendingRoundedRect.width,
      this.pendingRoundedRect.height,
    );
    this.pendingRoundedRect = null;
  }

  fillRect(x: number, y: number, width: number, height: number) {
    this.operations.push({
      fillStyle: this.fillStyle,
      globalAlpha: this.globalAlpha,
      height,
      kind: "fillRect",
      width,
      x,
      y,
    });
  }

  fillText(text: string, x: number, y: number) {
    this.operations.push({
      font: this.font,
      fillStyle: this.fillStyle,
      globalCompositeOperation: this.globalCompositeOperation,
      globalAlpha: this.globalAlpha,
      kind: "fillText",
      text,
      textAlign: this.textAlign,
      x,
      y,
    });
  }

  lineTo(x: number, y: number) {
    this.pendingPath.push({ kind: "lineTo", x, y });
  }

  measureText(text: string) {
    return {
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
      width: text.length * 8,
    } as TextMetrics;
  }

  moveTo(x: number, y: number) {
    this.pendingPath.push({ kind: "moveTo", x, y });
  }

  rect() {}

  restore() {
    const state = this.stateStack.pop();

    if (!state) {
      return;
    }

    this.fillStyle = state.fillStyle;
    this.font = state.font;
    this.globalAlpha = state.globalAlpha;
    this.globalCompositeOperation = state.globalCompositeOperation;
    this.lineCap = state.lineCap;
    this.lineJoin = state.lineJoin;
    this.lineWidth = state.lineWidth;
    this.strokeStyle = state.strokeStyle;
    this.textAlign = state.textAlign;
    this.textBaseline = state.textBaseline;
  }

  roundRect(x: number, y: number, width: number, height: number) {
    this.pendingRoundedRect = { height, width, x, y };
  }

  save() {
    this.stateStack.push({
      fillStyle: this.fillStyle,
      font: this.font,
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      lineWidth: this.lineWidth,
      strokeStyle: this.strokeStyle,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
    });
  }

  scale() {}

  stroke() {
    this.operations.push({
      kind: "strokePath",
      lineWidth: this.lineWidth,
      path: this.pendingPath,
      strokeStyle: this.strokeStyle,
    });
    this.pendingPath = [];
  }

  strokeRect(x: number, y: number, width: number, height: number) {
    this.operations.push({
      height,
      kind: "strokeRect",
      strokeStyle: this.strokeStyle,
      width,
      x,
      y,
    });
  }

  translate() {}
}

export function approximately(left: number, right: number, epsilon = 0.01) {
  return Math.abs(left - right) <= epsilon;
}

export function findLastOperationIndex(
  operations: RecordingOperation[],
  predicate: (operation: RecordingOperation) => boolean,
) {
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    if (predicate(operations[index]!)) {
      return index;
    }
  }

  return -1;
}

export function findFillTextOperation(operations: RecordingOperation[], text: string) {
  const operation = operations.find((candidate) => {
    return candidate.kind === "fillText" && candidate.text === text;
  });

  return operation?.kind === "fillText" ? operation : null;
}

export function liveDocumentChangeAt(
  state: EditorState,
  previousMarkdown: string,
  path: string,
  changeKey: string,
) {
  const change = findDocumentChanges(
    parseDocument(previousMarkdown),
    state.documentIndex.document,
  ).find((candidate) => candidate.anchor.path === path);

  if (!change) {
    throw new Error(`Expected live document change at ${path}`);
  }

  return { ...change, changeKey };
}
