import { expect, test } from "bun:test";
import {
  dispatchKey,
  toggleSelectionMark,
} from "@/editor/model/commands";
import {
  createDocumentFromEditorState,
  createEditorState,
  setCanvasSelection as setSelection,
} from "@/editor/model/state";
import { parseMarkdown, serializeMarkdown } from "@/markdown";

test("toggles strong and emphasis marks on a single-container selection", () => {
  let state = createEditorState(parseMarkdown("Plain text here.\n"));
  const paragraph = state.documentEditor.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  state = setSelection(state, {
    anchor: {
      regionId: paragraph.id,
      offset: 6,
    },
    focus: {
      regionId: paragraph.id,
      offset: 10,
    },
  });
  state = toggleSelectionMark(state, "bold") ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "Plain **text** here.\n",
  );

  state = toggleSelectionMark(state, "bold") ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "Plain text here.\n",
  );

  state = toggleSelectionMark(state, "italic") ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "Plain *text* here.\n",
  );
});

test("routes mod-b and mod-i through inline mark toggles", () => {
  let state = createEditorState(parseMarkdown("Paragraph body.\n"));
  const paragraph = state.documentEditor.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  state = setSelection(state, {
    anchor: {
      regionId: paragraph.id,
      offset: 0,
    },
    focus: {
      regionId: paragraph.id,
      offset: "Paragraph".length,
    },
  });
  state = dispatchKey(state, "toggleSelectionBold") ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "**Paragraph** body.\n",
  );

  state = dispatchKey(state, "toggleSelectionItalic") ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "***Paragraph*** body.\n",
  );
});

test("routes mod-u through inline underline toggles", () => {
  let state = createEditorState(parseMarkdown("Paragraph body.\n"));
  const paragraph = state.documentEditor.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  state = setSelection(state, {
    anchor: {
      regionId: paragraph.id,
      offset: "Paragraph body".length,
    },
    focus: {
      regionId: paragraph.id,
      offset: "Paragraph ".length,
    },
  });
  state = dispatchKey(state, "toggleSelectionUnderline") ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "Paragraph <ins>body</ins>.\n",
  );
});
