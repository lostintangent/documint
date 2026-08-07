import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import { createStore, type DocumintStore } from "@/component/store";
import {
  createEditorState,
  deleteBackward,
  insertLineBreak,
  insertText,
  setSelection,
  type EditorState,
} from "@/editor/state";
import { parseDocument, serializeDocument } from "@/markdown";

describe("local content notifications", () => {
  test("keep live-only trailing empty paragraphs out of external snapshot reconciliation", () => {
    const store = createStore(parseDocument("Alpha\n", {}));
    placeCaret(store, 0, "end");

    runCommandAndEmit(store, insertLineBreak);
    runCommandAndEmit(store, insertLineBreak);
    const emittedContent = runCommandAndEmit(store, insertLineBreak);

    expect(pathTexts(store.editor.getState())).toEqual(["Alpha", "", "", ""]);

    const reparsedEchoState = createEditorState(parseDocument(emittedContent, {}));
    expect(pathTexts(reparsedEchoState)).toEqual(["Alpha"]);
  });

  test.each([[">"], ["#"], ["-"], ["*"], ["+"], ["1."], ["---"], ["x"], ["  "]])(
    "keeps enter-type-delete stable before hidden suffix spaces after typing %p",
    (typedPrefix) => {
      const store = createStore(parseDocument("Alpha \n", {}));
      placeCaret(store, 0, 5);
      const emissions = [runCommandAndEmit(store, insertLineBreak)];

      emissions.push(runCommandAndEmit(store, insertText, typedPrefix));
      expect(pathTexts(store.editor.getState())).toEqual(["Alpha", `${typedPrefix} `]);

      for (const _ of typedPrefix) {
        emissions.push(runCommandAndEmit(store, deleteBackward));
      }

      expect(emissions.some((content) => content.includes("&#x20;"))).toBe(true);
      expect(pathTexts(store.editor.getState())).toEqual(["Alpha", " "]);
      expect(selectionOffset(store.editor.getState())).toBe(0);
    },
  );
});

function runCommandAndEmit<A extends unknown[]>(
  store: DocumintStore,
  command: (state: EditorState, ...args: A) => EditorState | null,
  ...args: A
) {
  const transition = store.editor.command(command, ...args);

  if (!transition) {
    throw new Error("Expected command to change the editor state.");
  }

  return serializeDocument(transition.next.documentIndex.document, {});
}

function placeCaret(store: DocumintStore, pathIndex: number, offset: number | "end") {
  const state = store.editor.getState();
  const path = indexedTextEntries(state)[pathIndex];

  if (!path) {
    throw new Error(`Missing path ${pathIndex}`);
  }

  const resolvedOffset = offset === "end" ? path.text.length : offset;
  const nextState = setSelection(state, {
    path: path.path,
    offset: resolvedOffset,
  });

  if (!nextState) {
    throw new Error("Expected setSelection to change state.");
  }

  store.editor.replace(nextState);
}

function pathTexts(state: EditorState) {
  return indexedTextEntries(state).map((path) => path.text);
}

function selectionOffset(state: EditorState) {
  if (!state.selection || state.selection.anchor.path !== state.selection.focus.path) {
    throw new Error("Expected a collapsed single-path selection.");
  }

  expect(state.selection.anchor.offset).toBe(state.selection.focus.offset);

  return state.selection.anchor.offset;
}
