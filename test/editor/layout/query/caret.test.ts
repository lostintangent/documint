import { indexedTextEntries } from "@test/editor/helpers";
import { expect, test } from "bun:test";
import { createDocument, createParagraphTextBlock } from "@/document";
import {
  createDocumentIndex,
  createEditorState,
  insertLineBreak,
  insertText,
  setSelection,
} from "@/editor/state";
import { measureCaretTarget, resolveCaretVisualLeft } from "@/editor/layout";
import { measureLayoutSlice } from "@/editor/layout/measure";
import { parseDocument } from "@/markdown";
import { getPathByType, placeAt, setup } from "../../helpers";

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

  const caret = measureCaretTarget(layout, runtime, {
    path: paragraphContainer.path,
    offset: 8,
  });

  expect(caret?.path).toBe(paragraphContainer.path);
  expect(caret?.offset).toBe(8);
  expect(caret?.left).toBeGreaterThan(layout.lines[1]!.left);
  expect(caret?.height).toBe(layout.options.lineHeight);
});

test("advances the active caret across collapsed trailing spaces", () => {
  const state = createEditorState(createDocument([createParagraphTextBlock("alpha ")]));
  const layout = measureLayoutSlice(state.documentIndex, {
    width: 320,
  });
  const paragraphContainer = indexedTextEntries(state)[0];

  if (!paragraphContainer) {
    throw new Error("Expected paragraph container");
  }

  const beforeSpace = measureCaretTarget(layout, state.documentIndex, {
    path: paragraphContainer.path,
    offset: 5,
  });
  const afterSpace = measureCaretTarget(layout, state.documentIndex, {
    path: paragraphContainer.path,
    offset: 6,
  });

  if (!beforeSpace || !afterSpace) {
    throw new Error("Expected paragraph carets");
  }

  expect(resolveCaretVisualLeft(state, layout, afterSpace)).toBeGreaterThan(
    resolveCaretVisualLeft(state, layout, beforeSpace),
  );
});

test("measures caret geometry inside a space-only paragraph", () => {
  const state = createEditorState(createDocument([createParagraphTextBlock(" ")]));
  const layout = measureLayoutSlice(state.documentIndex, {
    width: 320,
  });
  const paragraphContainer = indexedTextEntries(state)[0];

  if (!paragraphContainer) {
    throw new Error("Expected paragraph container");
  }

  const beforeSpace = measureCaretTarget(layout, state.documentIndex, {
    path: paragraphContainer.path,
    offset: 0,
  });
  const afterSpace = measureCaretTarget(layout, state.documentIndex, {
    path: paragraphContainer.path,
    offset: 1,
  });

  if (!beforeSpace || !afterSpace) {
    throw new Error("Expected paragraph carets");
  }

  expect(layout.lines.map((line) => line.text)).toEqual([""]);
  expect(resolveCaretVisualLeft(state, layout, afterSpace)).toBeGreaterThan(
    resolveCaretVisualLeft(state, layout, beforeSpace),
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
  const active = indexedTextEntries(state).find((path) => path.path === state.selection.focus.path);
  const caret = measureCaretTarget(layout, state.documentIndex, {
    path: state.selection.focus.path,
    offset: state.selection.focus.offset,
  });

  expect(active?.text).toBe(" ");
  expect(caret?.path).toBe(active?.path);
  expect(caret?.offset).toBe(0);
});

test("advances caret geometry after typing inside a code block", () => {
  let state = setup("```ts\nconst value = 1;\n```\n");
  const path = getPathByType(state, "code");

  state = placeAt(state, path, "const".length);

  const beforeLayout = measureLayoutSlice(state.documentIndex, { width: 320 });
  const beforeCaret = measureCaretTarget(beforeLayout, state.documentIndex, {
    path: state.selection.focus.path,
    offset: state.selection.focus.offset,
  });

  state = insertText(state, " next") ?? state;

  const nextPath = getPathByType(state, "code");
  const afterLayout = measureLayoutSlice(state.documentIndex, { width: 320 });
  const afterCaret = measureCaretTarget(afterLayout, state.documentIndex, {
    path: state.selection.focus.path,
    offset: state.selection.focus.offset,
  });

  if (!beforeCaret || !afterCaret) {
    throw new Error("Expected code block carets");
  }

  expect(nextPath.text).toBe("const next value = 1;");
  expect(state.selection.focus.offset).toBe("const next".length);
  expect(afterCaret.left).toBeGreaterThan(beforeCaret.left);
});

test("materializes the trailing empty source line in code blocks", () => {
  let state = setup("```ts\nconst value = 1;\n```\n");
  const path = getPathByType(state, "code");

  state = placeAt(state, path, "end");
  state = insertText(state, "\n") ?? state;

  const nextPath = getPathByType(state, "code");
  const layout = measureLayoutSlice(state.documentIndex, { width: 320 });
  const pathLines = layout.lines.filter((line) => line.path === nextPath.path);
  const caret = measureCaretTarget(layout, state.documentIndex, {
    path: state.selection.focus.path,
    offset: state.selection.focus.offset,
  });

  expect(pathLines.map((line) => line.text)).toEqual(["const value = 1;", ""]);
  expect(caret?.top).toBe(pathLines[1]!.top);
});
