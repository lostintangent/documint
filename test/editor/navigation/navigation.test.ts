import { expect, test } from "bun:test";
import {
  extendSelectionToPoint,
  moveCaretHorizontally,
  moveCaretToDocumentBoundary,
  moveCaretToLineBoundary,
  moveCaretVertically,
} from "@/editor/navigation";
import {
  createEditorLayoutState,
  createLayoutCache,
  resolveSelectionHit,
  type EditorState,
} from "@/editor";
import { getRegion, placeAt, setup } from "../helpers";

// Tall enough that the full layout is in view for every test fixture, so
// motion semantics aren't gated by virtualization or viewport clipping.
const TEST_VIEWPORT_HEIGHT = 2_000;

function layoutAt(state: EditorState, width: number) {
  return createEditorLayoutState(
    state,
    { height: TEST_VIEWPORT_HEIGHT, top: 0, width },
    createLayoutCache(),
  );
}

test("moves left to the previous container when the caret is at the start", () => {
  const state = setup("# Heading\n\nParagraph");
  const heading = getRegion(state, "Heading");
  const paragraph = getRegion(state, "Paragraph");
  const nextState = moveCaretHorizontally(placeAt(state, paragraph, "start"), -1);

  expect(nextState.selection.focus.regionId).toBe(heading.id);
  expect(nextState.selection.focus.offset).toBe(heading.text.length);
});

test("moves right to the next container when the caret is at the end", () => {
  const state = setup("# Heading\n\nParagraph");
  const heading = getRegion(state, "Heading");
  const paragraph = getRegion(state, "Paragraph");
  const nextState = moveCaretHorizontally(placeAt(state, heading, "end"), 1);

  expect(nextState.selection.focus.regionId).toBe(paragraph.id);
  expect(nextState.selection.focus.offset).toBe(0);
});

test("extends the selection to the left when shift-arrow-left is used repeatedly", () => {
  const state = setup("alpha");
  const region = getRegion(state, "alpha");
  const once = moveCaretHorizontally(placeAt(state, region, 4), -1, true);
  const twice = moveCaretHorizontally(once, -1, true);

  expect(once.selection.anchor.offset).toBe(4);
  expect(once.selection.focus.offset).toBe(3);
  expect(twice.selection.anchor.offset).toBe(4);
  expect(twice.selection.focus.offset).toBe(2);
});

test("extends the selection across regions when shift-arrow-right crosses a boundary", () => {
  const state = setup("alpha\n\nbeta");
  const first = getRegion(state, "alpha");
  const second = getRegion(state, "beta");
  const nextState = moveCaretHorizontally(placeAt(state, first, "end"), 1, true);

  expect(nextState.selection.anchor.regionId).toBe(first.id);
  expect(nextState.selection.anchor.offset).toBe(first.text.length);
  expect(nextState.selection.focus.regionId).toBe(second.id);
  expect(nextState.selection.focus.offset).toBe(0);
});

test("moves horizontally across images as atomic inline objects", () => {
  const state = setup("before ![alt](https://example.com/image.png) after\n");
  const container = state.documentIndex.regions[0];

  if (!container) {
    throw new Error("Expected paragraph container");
  }

  const imageRun = container.inlines.find((run) => run.kind === "image");

  if (!imageRun) {
    throw new Error("Expected image run");
  }

  const afterRight = moveCaretHorizontally(placeAt(state, container, imageRun.start), 1);
  const afterLeft = moveCaretHorizontally(placeAt(state, container, imageRun.end), -1);

  expect(afterRight.selection.focus.offset).toBe(imageRun.end);
  expect(afterLeft.selection.focus.offset).toBe(imageRun.start);
});

test("moves horizontally across grapheme clusters as atomic characters", () => {
  const state = setup("a ✈️ b");
  const region = getRegion(state, "a ✈️ b");
  const emojiStart = region.text.indexOf("✈️");
  const emojiEnd = emojiStart + "✈️".length;
  const afterLeft = moveCaretHorizontally(placeAt(state, region, emojiEnd), -1);
  const afterRight = moveCaretHorizontally(placeAt(state, region, emojiStart), 1);

  expect(afterLeft.selection.focus.offset).toBe(emojiStart);
  expect(afterRight.selection.focus.offset).toBe(emojiEnd);
});

test("extends horizontal selections by grapheme clusters", () => {
  const state = setup("a ✈️ b");
  const region = getRegion(state, "a ✈️ b");
  const emojiStart = region.text.indexOf("✈️");
  const emojiEnd = emojiStart + "✈️".length;
  const next = moveCaretHorizontally(placeAt(state, region, emojiEnd), -1, true);

  expect(next.selection.anchor.offset).toBe(emojiEnd);
  expect(next.selection.focus.offset).toBe(emojiStart);
});

test("extends the selection to the start of the current line", () => {
  const state = setup("alpha beta gamma");
  const container = getRegion(state, "alpha beta gamma");
  const layout = layoutAt(state, 90);
  const nextState = moveCaretToLineBoundary(placeAt(state, container, "end"), layout, "Home", true);

  expect(nextState.selection.anchor.regionId).toBe(container.id);
  expect(nextState.selection.anchor.offset).toBe(container.text.length);
  expect(nextState.selection.focus.regionId).toBe(container.id);
  expect(nextState.selection.focus.offset).toBeGreaterThan(0);
  expect(nextState.selection.focus.offset).toBeLessThan(container.text.length);
});

test("extends the selection to the end of the current line", () => {
  const state = setup("alpha beta gamma");
  const container = getRegion(state, "alpha beta gamma");
  const layout = layoutAt(state, 90);
  const nextState = moveCaretToLineBoundary(
    placeAt(state, container, "start"),
    layout,
    "End",
    true,
  );

  expect(nextState.selection.anchor.regionId).toBe(container.id);
  expect(nextState.selection.anchor.offset).toBe(0);
  expect(nextState.selection.focus.regionId).toBe(container.id);
  expect(nextState.selection.focus.offset).toBeGreaterThan(0);
  expect(nextState.selection.focus.offset).toBeLessThan(container.text.length);
});

test("moves vertically between table cells in the same column", () => {
  const state = setup("| A | B |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |");
  const beta = getRegion(state, "beta");
  const headerB = getRegion(state, "B");
  const delta = getRegion(state, "delta");
  const layout = layoutAt(state, 420);
  const upState = moveCaretVertically(placeAt(state, beta, 2), layout, -1);

  expect(upState.selection.focus.regionId).toBe(headerB.id);

  const downState = moveCaretVertically(placeAt(state, beta, 2), layout, 1);

  expect(downState.selection.focus.regionId).toBe(delta.id);
});

test("moves out of a table when there is no row above or below", () => {
  const state = setup("before\n\n| A | B |\n| --- | --- |\n| alpha | beta |\n\nafter");
  const headerB = getRegion(state, "B");
  const beta = getRegion(state, "beta");
  const before = getRegion(state, "before");
  const after = getRegion(state, "after");
  const layout = layoutAt(state, 420);
  const upState = moveCaretVertically(placeAt(state, headerB, 1), layout, -1);
  const downState = moveCaretVertically(placeAt(state, beta, 1), layout, 1);

  expect(upState.selection.focus.regionId).toBe(before.id);
  expect(downState.selection.focus.regionId).toBe(after.id);
});

test("extends the selection vertically across a region boundary while keeping the anchor", () => {
  const state = setup("alpha\n\nbeta\n\ngamma");
  const first = getRegion(state, "alpha");
  const second = getRegion(state, "beta");
  const layout = layoutAt(state, 320);
  const nextState = moveCaretVertically(placeAt(state, first, 2), layout, 1, true);

  expect(nextState.selection.anchor.regionId).toBe(first.id);
  expect(nextState.selection.anchor.offset).toBe(2);
  expect(nextState.selection.focus.regionId).toBe(second.id);
});

test("extends the selection to a viewport point while keeping the anchor", () => {
  const state = setup("Hello world\n");
  const region = getRegion(state, "Hello world");
  const placed = placeAt(state, region, 0);
  const viewport = createEditorLayoutState(
    placed,
    { height: 320, top: 0, width: 520 },
    createLayoutCache(),
  );
  const line = viewport.layout.lines[0];

  if (!line) throw new Error("Expected first layout line");

  const point = {
    x: line.left + line.width / 2,
    y: line.top + line.height / 2,
  };
  const hit = resolveSelectionHit(placed, viewport, point);
  const extended = extendSelectionToPoint(placed, viewport, point);

  expect(hit).not.toBeNull();
  expect(extended).not.toBeNull();
  expect(extended!.selection.anchor).toEqual({ offset: 0, regionId: region.id });
  expect(extended!.selection.focus).toEqual({
    offset: hit!.offset,
    regionId: hit!.regionId,
  });
});

test("jumps to the start of the document when moveCaretToDocumentBoundary is invoked with start", () => {
  const state = setup("alpha\n\nbeta\n\ngamma");
  const first = getRegion(state, "alpha");
  const third = getRegion(state, "gamma");
  const nextState = moveCaretToDocumentBoundary(placeAt(state, third, 2), "start");

  expect(nextState.selection.anchor).toEqual({ offset: 0, regionId: first.id });
  expect(nextState.selection.focus).toEqual({ offset: 0, regionId: first.id });
});

test("jumps to the end of the document when moveCaretToDocumentBoundary is invoked with end", () => {
  const state = setup("alpha\n\nbeta\n\ngamma");
  const first = getRegion(state, "alpha");
  const third = getRegion(state, "gamma");
  const nextState = moveCaretToDocumentBoundary(placeAt(state, first, "start"), "end");

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
  const state = setup("alpha\n\nbeta\n\ngamma");
  const first = getRegion(state, "alpha");
  const third = getRegion(state, "gamma");
  const nextState = moveCaretToDocumentBoundary(placeAt(state, first, 2), "end", true);

  expect(nextState.selection.anchor).toEqual({ offset: 2, regionId: first.id });
  expect(nextState.selection.focus).toEqual({
    offset: third.text.length,
    regionId: third.id,
  });
});

test("moves vertically across an inline soft break inside one paragraph", () => {
  // A paragraph with an inline `<br>` is laid out as two visual lines but
  // remains one region. Vertical navigation must walk between those lines
  // by changing the offset within the same region (rather than crossing a
  // region boundary), which also exercises the layout-driven caret math
  // for `\n` segments.
  const state = setup("foo<br>bar\n");
  const region = getRegion(state, "foo\nbar");
  const layout = layoutAt(state, 320);
  const downState = moveCaretVertically(placeAt(state, region, 1), layout, 1);

  expect(downState.selection.focus.regionId).toBe(region.id);
  // Crossing the soft break advances past the `\n` into the second line.
  expect(downState.selection.focus.offset).toBeGreaterThan(3);

  const upState = moveCaretVertically(downState, layout, -1);

  expect(upState.selection.focus.regionId).toBe(region.id);
  expect(upState.selection.focus.offset).toBeLessThanOrEqual(3);
});
