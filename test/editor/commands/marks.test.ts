import { expect, test } from "bun:test";
import { toggleBold, toggleItalic, toggleUnderline } from "@/editor/state";
import { createDocumentFromEditorState, createEditorState, setSelection } from "@/editor/state";
import { parseMarkdown, serializeMarkdown } from "@/markdown";

test("toggles strong and emphasis marks on a single-container selection", () => {
  let state = createEditorState(parseMarkdown("Plain text here.\n"));
  const paragraph = state.documentIndex.regions[0];

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
  state = toggleBold(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("Plain **text** here.\n");

  state = toggleBold(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("Plain text here.\n");

  state = toggleItalic(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("Plain *text* here.\n");
});

test("routes mod-b and mod-i through inline mark toggles", () => {
  let state = createEditorState(parseMarkdown("Paragraph body.\n"));
  const paragraph = state.documentIndex.regions[0];

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
  state = toggleBold(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("**Paragraph** body.\n");

  state = toggleItalic(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("***Paragraph*** body.\n");
});

test("routes mod-u through inline underline toggles", () => {
  let state = createEditorState(parseMarkdown("Paragraph body.\n"));
  const paragraph = state.documentIndex.regions[0];

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
  state = toggleUnderline(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "Paragraph <ins>body</ins>.\n",
  );
});
