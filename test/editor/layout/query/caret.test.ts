import { expect, test } from "bun:test";
import { createDocument, createParagraphTextBlock } from "@/document";
import { createDocumentIndex, createEditorState, insertText } from "@/editor/state";
import { measureCaretTarget, resolveCaretVisualLeft } from "@/editor/layout";
import { measureLayoutSlice } from "@/editor/layout/measure";
import { parseDocument } from "@/markdown";
import { getRegionByType, placeAt, setup } from "../../helpers";

test("measures caret geometry for a container offset", () => {
  const runtime = createDocumentIndex(
    parseDocument(`# Caret

Paragraph for caret metrics.
`),
  );
  const layout = measureLayoutSlice(runtime, {
    width: 220,
  });
  const paragraphContainer = runtime.regions[1];

  if (!paragraphContainer) {
    throw new Error("Expected paragraph container");
  }

  const caret = measureCaretTarget(layout, runtime, {
    regionId: paragraphContainer.id,
    offset: 8,
  });

  expect(caret?.regionId).toBe(paragraphContainer.id);
  expect(caret?.offset).toBe(8);
  expect(caret?.left).toBeGreaterThan(layout.lines[1]!.left);
  expect(caret?.height).toBe(layout.options.lineHeight);
});

test("advances the active caret across collapsed trailing spaces", () => {
  const state = createEditorState(createDocument([createParagraphTextBlock("alpha ")]));
  const layout = measureLayoutSlice(state.documentIndex, {
    width: 320,
  });
  const paragraphContainer = state.documentIndex.regions[0];

  if (!paragraphContainer) {
    throw new Error("Expected paragraph container");
  }

  const beforeSpace = measureCaretTarget(layout, state.documentIndex, {
    regionId: paragraphContainer.id,
    offset: 5,
  });
  const afterSpace = measureCaretTarget(layout, state.documentIndex, {
    regionId: paragraphContainer.id,
    offset: 6,
  });

  if (!beforeSpace || !afterSpace) {
    throw new Error("Expected paragraph carets");
  }

  expect(resolveCaretVisualLeft(state, layout, afterSpace)).toBeGreaterThan(
    resolveCaretVisualLeft(state, layout, beforeSpace),
  );
});

test("advances caret geometry after typing inside a code block", () => {
  let state = setup("```ts\nconst value = 1;\n```\n");
  const region = getRegionByType(state, "code");

  state = placeAt(state, region, "const".length);

  const beforeLayout = measureLayoutSlice(state.documentIndex, { width: 320 });
  const beforeCaret = measureCaretTarget(beforeLayout, state.documentIndex, state.selection.focus);

  state = insertText(state, " next") ?? state;

  const nextRegion = getRegionByType(state, "code");
  const afterLayout = measureLayoutSlice(state.documentIndex, { width: 320 });
  const afterCaret = measureCaretTarget(afterLayout, state.documentIndex, state.selection.focus);

  if (!beforeCaret || !afterCaret) {
    throw new Error("Expected code block carets");
  }

  expect(nextRegion.text).toBe("const next value = 1;");
  expect(state.selection.focus.offset).toBe("const next".length);
  expect(afterCaret.left).toBeGreaterThan(beforeCaret.left);
});

test("materializes the trailing empty source line in code blocks", () => {
  let state = setup("```ts\nconst value = 1;\n```\n");
  const region = getRegionByType(state, "code");

  state = placeAt(state, region, "end");
  state = insertText(state, "\n") ?? state;

  const nextRegion = getRegionByType(state, "code");
  const layout = measureLayoutSlice(state.documentIndex, { width: 320 });
  const regionLines = layout.lines.filter((line) => line.regionId === nextRegion.id);
  const caret = measureCaretTarget(layout, state.documentIndex, state.selection.focus);

  expect(regionLines.map((line) => line.text)).toEqual(["const value = 1;", ""]);
  expect(caret?.top).toBe(regionLines[1]!.top);
});
