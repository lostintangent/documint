// Tests for the overlay-canvas caret painter. These exercise `paintOverlay`
// — the public overlay entry — since presence carets only ever land on the
// overlay layer.

import { expect, test } from "bun:test";
import type { EditorPresence } from "@/editor/anchors";
import { paintOverlay } from "@/renderer";
import { createEditorLayoutState } from "@/editor/layout";
import { normalizeSelection, setSelection, type EditorState } from "@/editor/state";
import { lightTheme, resolveEditorTheme } from "@/component/lib/themes";
import { findOperationIndex, RecordingCanvasContext } from "./helpers";
import { setup } from "../editor/helpers";

const resolvedLightTheme = resolveEditorTheme(lightTheme);

test("paints resolved presence cursors on the overlay canvas", () => {
  let state = setup("alpha beta gamma\n");
  const container = state.documentIndex.regions[0];

  if (!container) {
    throw new Error("Expected paragraph container");
  }

  state = setSelection(state, {
    regionId: container.id,
    offset: 1,
  });

  const { context } = renderOverlayOperations(state, {
    height: 180,
    presence: [
      {
        cursor: {
          prefix: "alpha",
        },
        color: "#0ea5e9",
        commentThreadIndex: null,
        cursorPoint: {
          regionId: container.id,
          offset: 5,
        },
        id: "user",
        isOnUnresolvedCommentThread: false,
        username: "User",
        viewport: null,
      },
    ],
    width: 240,
  });
  const userCaretIndex = findOperationIndex(context.operations, (operation) => {
    return operation.kind === "fillRect" && operation.fillStyle === resolvedLightTheme.caret;
  });
  const presenceCaretIndex = findOperationIndex(context.operations, (operation) => {
    return operation.kind === "fillRect" && operation.fillStyle === "#0ea5e9";
  });

  expect(userCaretIndex).toBeGreaterThanOrEqual(0);
  expect(presenceCaretIndex).toBeGreaterThanOrEqual(0);
});

test("skips unresolved presence cursors during overlay paint", () => {
  const state = setup("alpha beta gamma\n");
  const { context } = renderOverlayOperations(state, {
    height: 180,
    presence: [
      {
        cursor: {
          prefix: "missing",
        },
        color: "#0ea5e9",
        commentThreadIndex: null,
        cursorPoint: null,
        id: "user",
        isOnUnresolvedCommentThread: false,
        username: "User",
        viewport: null,
      },
    ],
    width: 240,
  });
  const presenceCaretIndex = findOperationIndex(context.operations, (operation) => {
    return operation.kind === "fillRect" && operation.fillStyle === "#0ea5e9";
  });

  expect(presenceCaretIndex).toBe(-1);
});

function renderOverlayOperations(
  state: EditorState,
  options: {
    height: number;
    presence: EditorPresence[];
    width: number;
  },
) {
  const layoutState = createEditorLayoutState(state, {
    height: options.height,
    top: 0,
    width: options.width,
  });
  const context = new RecordingCanvasContext();

  paintOverlay(state, layoutState, context as unknown as CanvasRenderingContext2D, {
    devicePixelRatio: 1,
    height: options.height,
    normalizedSelection: normalizeSelection(state),
    presence: options.presence,
    showCaret: true,
    theme: resolvedLightTheme,
    width: options.width,
  });

  return {
    context,
    layout: layoutState.layout,
  };
}
