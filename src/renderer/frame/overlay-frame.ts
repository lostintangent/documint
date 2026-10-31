import type { EditorPresence } from "@/editor/anchors";
import { measureVisualCaret, type EditorLayoutState } from "@/editor/layout";
import type { EditorState, NormalizedEditorSelection } from "@/editor/state";
import { resolveCenteredTextTop, resolveFontMetrics } from "@/editor/text/measure";
import type { ResolvedEditorTheme } from "../theme";
import type { PaintLayerFrame } from "./document-frame";

const caretOpticalTopInset = 1;
const caretVerticalInset = 2;

export function createOverlayFrame(
  editorState: EditorState,
  layoutState: EditorLayoutState,
  options: CreateOverlayFrameOptions,
): OverlayFrame {
  const carets: OverlayCaretFrame[] = [];
  const shouldPaintUserCaret = options.showCaret && options.normalizedSelection.collapsed;

  if (shouldPaintUserCaret) {
    const caret = resolveOverlayCaretFrame(layoutState, {
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

      const caret = resolveOverlayCaretFrame(layoutState, {
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
  layoutState: EditorLayoutState,
  target: {
    color: string;
    offset: number;
    path: string;
  },
): OverlayCaretFrame | null {
  const visualCaret = measureVisualCaret(layoutState.layout, target);

  if (!visualCaret) {
    return null;
  }

  const { caret, line } = visualCaret;
  const { ascent, descent } = resolveFontMetrics(line.font);
  const glyphHeight = Math.max(1, ascent + descent);

  return {
    color: target.color,
    height: Math.min(line.height - caretVerticalInset, glyphHeight),
    left: caret.left,
    top: Math.max(
      line.top,
      line.top + resolveCenteredTextTop(line.height, line.font) - caretOpticalTopInset,
    ),
  };
}
