import { expect, test } from "bun:test";
import {
  toggleSelectionInlineCode,
} from "@/editor/model/commands";
import {
  createDocumentFromEditorState,
  createEditorState,
  setCanvasSelection as setSelection,
} from "@/editor/model/state";
import { parseMarkdown, serializeMarkdown } from "@/markdown";

test("toggles inline code on and off for a single-container selection", () => {
  let state = createEditorState(parseMarkdown("Paragraph body.\n"));
  const paragraph = state.documentEditor.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  state = setSelection(state, {
    anchor: {
      regionId: paragraph.id,
      offset: "Paragraph ".length,
    },
    focus: {
      regionId: paragraph.id,
      offset: "Paragraph body".length,
    },
  });
  state = toggleSelectionInlineCode(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "Paragraph `body`.\n",
  );

  state = toggleSelectionInlineCode(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "Paragraph body.\n",
  );
});

test("routes mod-e through inline code toggles", () => {
  let state = createEditorState(parseMarkdown("Call fn here.\n"));
  const paragraph = state.documentEditor.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  state = setSelection(state, {
    anchor: {
      regionId: paragraph.id,
      offset: 5,
    },
    focus: {
      regionId: paragraph.id,
      offset: 7,
    },
  });
  state = toggleSelectionInlineCode(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "Call `fn` here.\n",
  );
});
