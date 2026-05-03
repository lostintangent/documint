// Tests for the overlay-canvas caret painter. These exercise
// `paintCanvasCaretOverlay` directly (rather than through the content paint
// pipeline) since presence carets only ever land on the overlay layer.

import { expect, test } from "bun:test";
import type { EditorPresence } from "@/editor/anchors";
import { paintCanvasCaretOverlay } from "@/editor/canvas";
import { createDocumentLayout } from "@/editor/layout";
import { setSelection, type EditorState } from "@/editor/state";
import { lightTheme } from "@/component/lib/themes";
import { findOperationIndex, RecordingCanvasContext } from "../helpers";
import { setup } from "../../helpers";

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
        cursorPoint: {
          regionId: container.id,
          offset: 5,
        },
        id: "user",
        username: "User",
        viewport: null,
      },
    ],
    width: 240,
  });
  const userCaretIndex = findOperationIndex(context.operations, (operation) => {
    return operation.kind === "fillRect" && operation.fillStyle === lightTheme.caret;
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
        cursorPoint: null,
        id: "user",
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
  const layout = createDocumentLayout(state.documentIndex, { width: options.width });
  const context = new RecordingCanvasContext();

  paintCanvasCaretOverlay({
    context: context as unknown as CanvasRenderingContext2D,
    devicePixelRatio: 1,
    editorState: state,
    height: options.height,
    layout,
    normalizedSelection: {
      end: state.selection.focus,
      start: state.selection.anchor,
    },
    presence: options.presence,
    showCaret: true,
    theme: lightTheme,
    viewportTop: 0,
    width: options.width,
  });

  return {
    context,
    layout,
  };
}
