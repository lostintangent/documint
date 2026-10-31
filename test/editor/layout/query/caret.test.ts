import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import { createDocument, createParagraphTextBlock } from "@/document";
import {
  createDocumentIndex,
  createEditorState,
  insertLineBreak,
  insertText,
  setSelection,
} from "@/editor/state";
import {
  findLineForPathOffset,
  measureCaretTarget,
  measureVisualCaret,
  resolveCaretVisualLeft,
} from "@/editor/layout";
import { measureLayoutSlice } from "@/editor/layout/measure";
import { parseDocument } from "@/markdown";
import { getPath, getPathByType, placeAt, setup } from "../../helpers";

describe("Caret targets", () => {
  test("measures caret geometry for a container offset", () => {
    const runtime = createDocumentIndex(
      parseDocument(`# Caret

Paragraph for caret metrics.
`),
    );
    const layout = measureLayoutSlice(runtime, {
      width: 220,
    });
    const paragraphContainer = indexedTextEntries(runtime)[1];

    if (!paragraphContainer) {
      throw new Error("Expected paragraph container");
    }

    const caret = measureCaretTarget(layout, {
      path: paragraphContainer.path,
      offset: 8,
    });

    expect(caret?.path).toBe(paragraphContainer.path);
    expect(caret?.offset).toBe(8);
    expect(caret?.left).toBeGreaterThan(layout.lines[1]!.left);
    expect(caret?.height).toBe(layout.options.lineHeight);
  });

  test("resolves the visual caret and its line with one query", () => {
    const state = createEditorState(parseDocument("- alpha beta\n"));
    const layout = measureLayoutSlice(state.documentIndex, {
      width: 320,
    });
    const itemContainer = indexedTextEntries(state)[0];

    if (!itemContainer) {
      throw new Error("Expected list item container");
    }

    for (const offset of [0, 5, 10]) {
      const target = { path: itemContainer.path, offset };
      const caret = measureCaretTarget(layout, target);
      const visualCaret = measureVisualCaret(layout, target);

      if (!caret || !visualCaret) {
        throw new Error("Expected list item caret");
      }

      expect(visualCaret.line).toBe(findLineForPathOffset(layout, target.path, offset)!);
      expect(visualCaret.line.contentInset).toBeGreaterThan(0);
      expect(visualCaret.caret).toEqual({
        ...caret,
        left: resolveCaretVisualLeft(layout, caret),
      });
    }

    expect(measureVisualCaret(layout, { path: "missing", offset: 0 })).toBeNull();
  });

  test("advances caret geometry after typing inside a code block", () => {
    let state = setup("```ts\nconst value = 1;\n```\n");
    const path = getPathByType(state, "code");

    state = placeAt(state, path, "const".length);

    const beforeLayout = measureLayoutSlice(state.documentIndex, { width: 320 });
    const beforeCaret = measureCaretTarget(beforeLayout, {
      path: state.selection.focus.path,
      offset: state.selection.focus.offset,
    });

    state = insertText(state, " next") ?? state;

    const afterLayout = measureLayoutSlice(state.documentIndex, { width: 320 });
    const afterCaret = measureCaretTarget(afterLayout, {
      path: state.selection.focus.path,
      offset: state.selection.focus.offset,
    });

    if (!beforeCaret || !afterCaret) {
      throw new Error("Expected code block carets");
    }

    expect(afterCaret.left).toBeGreaterThan(beforeCaret.left);
  });
});

describe("Trailing spaces", () => {
  test.each([
    { after: 6, before: 5, label: "a trailing space", lines: ["alpha "], text: "alpha " },
    { after: 1, before: 0, label: "a space-only paragraph", lines: [" "], text: " " },
  ])("advances the caret across $label", ({ after, before, lines, text }) => {
    const state = createEditorState(createDocument([createParagraphTextBlock(text)]));
    const layout = measureLayoutSlice(state.documentIndex, { width: 320 });
    const { path } = getPath(state, text);
    const beforeSpace = measureCaretTarget(layout, { offset: before, path });
    const afterSpace = measureCaretTarget(layout, { offset: after, path });

    if (!beforeSpace || !afterSpace) {
      throw new Error("Expected paragraph carets");
    }

    expect(layout.lines.map((line) => line.text)).toEqual([...lines]);
    expect(resolveCaretVisualLeft(layout, afterSpace)).toBeGreaterThan(
      resolveCaretVisualLeft(layout, beforeSpace),
    );
  });

  test("measures the empty-looking paragraph produced by Enter before a trailing space", () => {
    let state = createEditorState(createDocument([createParagraphTextBlock("alpha ")]));
    const paragraphContainer = indexedTextEntries(state)[0];

    if (!paragraphContainer) {
      throw new Error("Expected paragraph container");
    }

    state = setSelection(state, { path: paragraphContainer.path, offset: "alpha".length });
    state = insertLineBreak(state) ?? state;

    const layout = measureLayoutSlice(state.documentIndex, {
      width: 320,
    });
    const active = indexedTextEntries(state).find(
      (path) => path.path === state.selection.focus.path,
    );
    const caret = measureCaretTarget(layout, {
      path: state.selection.focus.path,
      offset: state.selection.focus.offset,
    });

    expect(active?.text).toBe(" ");
    expect(caret?.path).toBe(active?.path);
    expect(caret?.offset).toBe(0);
  });
});
