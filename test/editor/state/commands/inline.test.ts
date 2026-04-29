import { expect, test } from "bun:test";
import { insertImage, resizeImage, toggleBold, toggleCode, toggleItalic, toggleStrikethrough, toggleUnderline } from "@/editor/state";
import { createDocumentFromEditorState, createEditorState, setSelection } from "@/editor/state";
import { parseMarkdown, serializeMarkdown } from "@/markdown";
import { getRegion, placeAt, selectSubstring, setup, toMarkdown } from "../helpers";

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

test("toggles inline code on and off for a single-container selection", () => {
  let state = createEditorState(parseMarkdown("Paragraph body.\n"));
  const paragraph = state.documentIndex.regions[0];

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
  state = toggleCode(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("Paragraph `body`.\n");

  state = toggleCode(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("Paragraph body.\n");
});

test("routes mod-e through inline code toggles", () => {
  let state = createEditorState(parseMarkdown("Call fn here.\n"));
  const paragraph = state.documentIndex.regions[0];

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
  state = toggleCode(state) ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("Call `fn` here.\n");
});

test("toggles strikethrough on and off", () => {
  const state = setup("Hello world\n");
  const region = getRegion(state, "Hello world");
  const selected = selectSubstring(state, region, "world");
  const on = toggleStrikethrough(selected) ?? selected;

  expect(toMarkdown(on)).toBe("Hello ~~world~~\n");

  const off = toggleStrikethrough(on) ?? on;

  expect(toMarkdown(off)).toBe("Hello world\n");
});

test("inserts an image inline at the current caret position", () => {
  const base = setup("caption\n");
  const region = getRegion(base, "caption");
  const placed = placeAt(base, region, "end");
  const next = insertImage(placed, "https://example.com/img.png", "alt text");

  expect(next).not.toBeNull();
  expect(toMarkdown(next!)).toContain("![alt text](https://example.com/img.png)");
});

test("resizes an image by replacing it with a new width attribute", () => {
  const state = setup("before ![alt](https://example.com/img.png) after\n");
  const region = getRegion(state, "before \uFFFC after");
  const imageRun = region.inlines.find((r) => r.kind === "image");

  if (!imageRun?.image) {
    throw new Error("Expected image run");
  }

  const next = resizeImage(state, region.id, { start: imageRun.start, end: imageRun.end, image: imageRun.image }, 320);

  expect(next).not.toBeNull();
  expect(toMarkdown(next!)).toContain("![alt](https://example.com/img.png)");
});
