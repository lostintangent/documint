import { expect, test } from "bun:test";
import { createDocument, createParagraphTextBlock } from "@/document";
import { createDocumentIndex, createEditorState } from "@/editor/state";
import {
  createDocumentLayout,
  measureCaretTarget,
  resolveCaretVisualLeft,
} from "@/editor/layout";
import { parseDocument } from "@/markdown";

test("measures caret geometry for a container offset", () => {
  const runtime = createDocumentIndex(
    parseDocument(`# Caret

Paragraph for caret metrics.
`),
  );
  const layout = createDocumentLayout(runtime, {
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
  const state = createEditorState(
    createDocument([
      createParagraphTextBlock({
        text: "alpha ",
      }),
    ]),
  );
  const layout = createDocumentLayout(state.documentIndex, {
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
