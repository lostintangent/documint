import type { EditorPresence } from "@/editor/anchors";
import {
  findLineForPathOffset,
  measureCaretTarget,
  resolveCaretVisualLeft,
  type EditorLayoutState,
} from "@/editor/layout";
import type { EditorState, NormalizedEditorSelection } from "@/editor/state";
import { resolveCenteredTextTop, resolveFontMetrics } from "@/editor/text/measure";
import type { ResolvedEditorTheme } from "@/types";
import type { PaintLayerFrame } from "./document-frame";

const caretOpticalTopInset = 1;
const caretVerticalInset = 2;

export function createOverlayFrame(
  editorState: EditorState,
  layoutState: EditorLayoutState,
  options: CreateOverlayFrameOptions,
): OverlayFrame {
  const carets: OverlayCaretFrame[] = [];
  const hasRangeSelection =
    options.normalizedSelection.start.path !== options.normalizedSelection.end.path ||
    options.normalizedSelection.start.offset !== options.normalizedSelection.end.offset;
  const shouldPaintUserCaret = options.showCaret && !hasRangeSelection;

  if (shouldPaintUserCaret) {
    const caret = resolveOverlayCaretFrame(editorState, layoutState, {
      color: options.theme.caret,
      offset: editorState.selection.focus.offset,
      path: editorState.selection.focus.path,
    });

    if (caret) {
      carets.push(caret);
    }
  }

  if (options.presence) {
    for (const presence of options.presence) {
      if (!presence.cursorPoint) {
        continue;
      }

      const caret = resolveOverlayCaretFrame(editorState, layoutState, {
        color: presence.color ?? options.theme.leafAccent,
        offset: presence.cursorPoint.offset,
        path: presence.cursorPoint.path,
      });

      if (caret) {
        carets.push(caret);
      }
    }
  }

  return {
    carets,
    layer: {
      devicePixelRatio: options.devicePixelRatio,
      height: options.height,
      paintTop: layoutState.paintTop,
      width: options.width,
    },
  };
}

type CreateOverlayFrameOptions = {
  devicePixelRatio: number;
  height: number;
  normalizedSelection: NormalizedEditorSelection;
  presence?: EditorPresence[];
  showCaret: boolean;
  theme: ResolvedEditorTheme;
  width: number;
};

export type OverlayFrame = {
  readonly carets: readonly OverlayCaretFrame[];
  readonly layer: PaintLayerFrame;
};

export type OverlayCaretFrame = {
  readonly color: string;
  readonly height: number;
  readonly left: number;
  readonly top: number;
};

function resolveOverlayCaretFrame(
  editorState: EditorState,
  layoutState: EditorLayoutState,
  target: {
    color: string;
    offset: number;
    path: string;
  },
): OverlayCaretFrame | null {
  const measured = measureCaretTarget(layoutState.layout, editorState.documentIndex, target);

  if (!measured) {
    return null;
  }

  const left = resolveCaretVisualLeft(editorState, layoutState.layout, measured);
  const metrics = resolveCaretPaintMetrics(layoutState, measured);

  return {
    color: target.color,
    height: metrics.height,
    left,
    top: metrics.top,
  };
}

function resolveCaretPaintMetrics(
  layoutState: EditorLayoutState,
  caret: NonNullable<ReturnType<typeof measureCaretTarget>>,
) {
  const line = findLineForPathOffset(layoutState.layout, caret.path, caret.offset);
  const font =
    line?.font ??
    '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const { ascent, descent } = resolveFontMetrics(font);
  const glyphHeight = Math.max(1, ascent + descent);
  const height = Math.min(caret.height - caretVerticalInset, glyphHeight);
  const top = line
    ? Math.max(
        line.top,
        line.top + resolveCenteredTextTop(line.height, font) - caretOpticalTopInset,
      )
    : caret.top + Math.max(0, Math.floor((caret.height - height) / 2));

  return {
    height,
    top,
  };
}
