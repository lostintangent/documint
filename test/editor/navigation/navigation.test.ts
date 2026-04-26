import { expect, test } from "bun:test";
import {
  moveCaretHorizontally,
  moveCaretToDocumentBoundary,
  moveCaretToLineBoundary,
  moveCaretVertically,
} from "@/editor/navigation";
import { createEditorState, setSelection } from "@/editor/state";
import { createDocumentLayout } from "@/editor/layout";
import { parseMarkdown } from "@/markdown";

test("moves left to the previous container when the caret is at the start", () => {
  const state = createEditorState(parseMarkdown("# Heading\n\nParagraph"));
  const paragraphContainer = state.documentIndex.regions.find(
    (entry) => entry.blockType === "paragraph",
  );

  expect(paragraphContainer).toBeDefined();

  const nextState = moveCaretHorizontally(
    setSelection(state, {
      regionId: paragraphContainer!.id,
      offset: 0,
    }),
    -1,
  );

  expect(nextState.selection.focus.regionId).toBe(state.documentIndex.regions[0]!.id);
  expect(nextState.selection.focus.offset).toBe(state.documentIndex.regions[0]!.text.length);
});

test("moves right to the next container when the caret is at the end", () => {
  const state = createEditorState(parseMarkdown("# Heading\n\nParagraph"));
  const headingContainer = state.documentIndex.regions.find(
    (entry) => entry.blockType === "heading",
  );

  expect(headingContainer).toBeDefined();

  const nextState = moveCaretHorizontally(
    setSelection(state, {
      regionId: headingContainer!.id,
      offset: headingContainer!.text.length,
    }),
    1,
  );

  expect(nextState.selection.focus.regionId).toBe(state.documentIndex.regions[1]!.id);
  expect(nextState.selection.focus.offset).toBe(0);
});

test("extends the selection to the left when shift-arrow-left is used repeatedly", () => {
  const state = createEditorState(parseMarkdown("alpha"));
  const container = state.documentIndex.regions[0];

  expect(container).toBeDefined();

  const once = moveCaretHorizontally(
    setSelection(state, {
      anchor: {
        regionId: container!.id,
        offset: 4,
      },
      focus: {
        regionId: container!.id,
        offset: 4,
      },
    }),
    -1,
    true,
  );
  const twice = moveCaretHorizontally(once, -1, true);

  expect(once.selection.anchor.offset).toBe(4);
  expect(once.selection.focus.offset).toBe(3);
  expect(twice.selection.anchor.offset).toBe(4);
  expect(twice.selection.focus.offset).toBe(2);
});

test("extends the selection across regions when shift-arrow-right crosses a boundary", () => {
  const state = createEditorState(parseMarkdown("alpha\n\nbeta"));
  const firstContainer = state.documentIndex.regions[0];
  const secondContainer = state.documentIndex.regions[1];

  expect(firstContainer).toBeDefined();
  expect(secondContainer).toBeDefined();

  const nextState = moveCaretHorizontally(
    setSelection(state, {
      anchor: {
        regionId: firstContainer!.id,
        offset: firstContainer!.text.length,
      },
      focus: {
        regionId: firstContainer!.id,
        offset: firstContainer!.text.length,
      },
    }),
    1,
    true,
  );

  expect(nextState.selection.anchor.regionId).toBe(firstContainer!.id);
  expect(nextState.selection.anchor.offset).toBe(firstContainer!.text.length);
  expect(nextState.selection.focus.regionId).toBe(secondContainer!.id);
  expect(nextState.selection.focus.offset).toBe(0);
});

test("moves horizontally across images as atomic inline objects", () => {
  const state = createEditorState(
    parseMarkdown("before ![alt](https://example.com/image.png) after\n"),
  );
  const container = state.documentIndex.regions[0];

  if (!container) {
    throw new Error("Expected paragraph container");
  }

  const imageRun = container.inlines.find((run) => run.kind === "image");

  if (!imageRun) {
    throw new Error("Expected image run");
  }

  const afterRight = moveCaretHorizontally(
    setSelection(state, {
      regionId: container.id,
      offset: imageRun.start,
    }),
    1,
  );
  const afterLeft = moveCaretHorizontally(
    setSelection(state, {
      regionId: container.id,
      offset: imageRun.end,
    }),
    -1,
  );

  expect(afterRight.selection.focus.offset).toBe(imageRun.end);
  expect(afterLeft.selection.focus.offset).toBe(imageRun.start);
});

test("extends the selection to the start of the current line", () => {
  const state = createEditorState(parseMarkdown("alpha beta gamma"));
  const container = state.documentIndex.regions[0];

  expect(container).toBeDefined();

  const layout = createDocumentLayout(state.documentIndex, { width: 90 });
  const nextState = moveCaretToLineBoundary(
    setSelection(state, {
      anchor: {
        regionId: container!.id,
        offset: container!.text.length,
      },
      focus: {
        regionId: container!.id,
        offset: container!.text.length,
      },
    }),
    layout,
    "Home",
    true,
  );

  expect(nextState.selection.anchor.regionId).toBe(container!.id);
  expect(nextState.selection.anchor.offset).toBe(container!.text.length);
  expect(nextState.selection.focus.regionId).toBe(container!.id);
  expect(nextState.selection.focus.offset).toBeGreaterThan(0);
  expect(nextState.selection.focus.offset).toBeLessThan(container!.text.length);
});

test("extends the selection to the end of the current line", () => {
  const state = createEditorState(parseMarkdown("alpha beta gamma"));
  const container = state.documentIndex.regions[0];

  expect(container).toBeDefined();

  const layout = createDocumentLayout(state.documentIndex, { width: 90 });
  const nextState = moveCaretToLineBoundary(
    setSelection(state, {
      anchor: {
        regionId: container!.id,
        offset: 0,
      },
      focus: {
        regionId: container!.id,
        offset: 0,
      },
    }),
    layout,
    "End",
    true,
  );

  expect(nextState.selection.anchor.regionId).toBe(container!.id);
  expect(nextState.selection.anchor.offset).toBe(0);
  expect(nextState.selection.focus.regionId).toBe(container!.id);
  expect(nextState.selection.focus.offset).toBeGreaterThan(0);
  expect(nextState.selection.focus.offset).toBeLessThan(container!.text.length);
});

test("moves vertically between table cells in the same column", () => {
  const state = createEditorState(
    parseMarkdown("| A | B |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |"),
  );
  const beta = state.documentIndex.regions.find((entry) => entry.text === "beta");

  expect(beta).toBeDefined();

  const layout = createDocumentLayout(state.documentIndex, { width: 420 });
  const upState = moveCaretVertically(
    setSelection(state, {
      regionId: beta!.id,
      offset: 2,
    }),
    layout,
    -1,
  );

  expect(upState.selection.focus.regionId).toBe(
    state.documentIndex.regions.find((entry) => entry.text === "B")!.id,
  );

  const downState = moveCaretVertically(
    setSelection(state, {
      regionId: beta!.id,
      offset: 2,
    }),
    layout,
    1,
  );

  expect(downState.selection.focus.regionId).toBe(
    state.documentIndex.regions.find((entry) => entry.text === "delta")!.id,
  );
});

test("moves out of a table when there is no row above or below", () => {
  const state = createEditorState(
    parseMarkdown("before\n\n| A | B |\n| --- | --- |\n| alpha | beta |\n\nafter"),
  );
  const headerB = state.documentIndex.regions.find((entry) => entry.text === "B");
  const beta = state.documentIndex.regions.find((entry) => entry.text === "beta");

  expect(headerB).toBeDefined();
  expect(beta).toBeDefined();

  const layout = createDocumentLayout(state.documentIndex, { width: 420 });
  const upState = moveCaretVertically(
    setSelection(state, {
      regionId: headerB!.id,
      offset: 1,
    }),
    layout,
    -1,
  );
  const downState = moveCaretVertically(
    setSelection(state, {
      regionId: beta!.id,
      offset: 1,
    }),
    layout,
    1,
  );

  expect(state.documentIndex.regionIndex.get(upState.selection.focus.regionId)?.blockType).toBe(
    "paragraph",
  );
  expect(state.documentIndex.regionIndex.get(downState.selection.focus.regionId)?.blockType).toBe(
    "paragraph",
  );
  expect(state.documentIndex.regionIndex.get(upState.selection.focus.regionId)?.text).toBe(
    "before",
  );
  expect(state.documentIndex.regionIndex.get(downState.selection.focus.regionId)?.text).toBe(
    "after",
  );
});

test("extends the selection vertically across a region boundary while keeping the anchor", () => {
  const state = createEditorState(parseMarkdown("alpha\n\nbeta\n\ngamma"));
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected two paragraph regions");
  }

  const layout = createDocumentLayout(state.documentIndex, { width: 320 });
  const nextState = moveCaretVertically(
    setSelection(state, { regionId: first.id, offset: 2 }),
    layout,
    1,
    true,
  );

  expect(nextState.selection.anchor.regionId).toBe(first.id);
  expect(nextState.selection.anchor.offset).toBe(2);
  expect(nextState.selection.focus.regionId).toBe(second.id);
});

test("jumps to the start of the document when moveCaretToDocumentBoundary is invoked with start", () => {
  const state = createEditorState(parseMarkdown("alpha\n\nbeta\n\ngamma"));
  const [first, , third] = state.documentIndex.regions;

  if (!first || !third) {
    throw new Error("Expected three paragraph regions");
  }

  const nextState = moveCaretToDocumentBoundary(
    setSelection(state, { regionId: third.id, offset: 2 }),
    "start",
  );

  expect(nextState.selection.anchor).toEqual({ offset: 0, regionId: first.id });
  expect(nextState.selection.focus).toEqual({ offset: 0, regionId: first.id });
});

test("jumps to the end of the document when moveCaretToDocumentBoundary is invoked with end", () => {
  const state = createEditorState(parseMarkdown("alpha\n\nbeta\n\ngamma"));
  const [first, , third] = state.documentIndex.regions;

  if (!first || !third) {
    throw new Error("Expected three paragraph regions");
  }

  const nextState = moveCaretToDocumentBoundary(
    setSelection(state, { regionId: first.id, offset: 0 }),
    "end",
  );

  expect(nextState.selection.anchor).toEqual({
    offset: third.text.length,
    regionId: third.id,
  });
  expect(nextState.selection.focus).toEqual({
    offset: third.text.length,
    regionId: third.id,
  });
});

test("extends the selection to the end of the document while keeping the anchor", () => {
  const state = createEditorState(parseMarkdown("alpha\n\nbeta\n\ngamma"));
  const [first, , third] = state.documentIndex.regions;

  if (!first || !third) {
    throw new Error("Expected three paragraph regions");
  }

  const nextState = moveCaretToDocumentBoundary(
    setSelection(state, { regionId: first.id, offset: 2 }),
    "end",
    true,
  );

  expect(nextState.selection.anchor).toEqual({ offset: 2, regionId: first.id });
  expect(nextState.selection.focus).toEqual({
    offset: third.text.length,
    regionId: third.id,
  });
});
