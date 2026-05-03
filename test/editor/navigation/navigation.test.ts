import { describe, expect, test } from "bun:test";
import {
  moveCaretHorizontally,
  moveCaretToDocumentBoundary,
  moveCaretToLineBoundary,
  moveCaretVertically,
} from "@/editor/navigation";
import { createDocumentLayout } from "@/editor/layout";
import { getRegion, placeAt, setup } from "../helpers";

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

test("extends the selection to the start of the current line", () => {
  const state = setup("alpha beta gamma");
  const container = getRegion(state, "alpha beta gamma");
  const layout = createDocumentLayout(state.documentIndex, { width: 90 });
  const nextState = moveCaretToLineBoundary(
    placeAt(state, container, "end"),
    layout,
    "Home",
    true,
  );

  expect(nextState.selection.anchor.regionId).toBe(container.id);
  expect(nextState.selection.anchor.offset).toBe(container.text.length);
  expect(nextState.selection.focus.regionId).toBe(container.id);
  expect(nextState.selection.focus.offset).toBeGreaterThan(0);
  expect(nextState.selection.focus.offset).toBeLessThan(container.text.length);
});

test("extends the selection to the end of the current line", () => {
  const state = setup("alpha beta gamma");
  const container = getRegion(state, "alpha beta gamma");
  const layout = createDocumentLayout(state.documentIndex, { width: 90 });
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
  const layout = createDocumentLayout(state.documentIndex, { width: 420 });
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
  const layout = createDocumentLayout(state.documentIndex, { width: 420 });
  const upState = moveCaretVertically(placeAt(state, headerB, 1), layout, -1);
  const downState = moveCaretVertically(placeAt(state, beta, 1), layout, 1);

  expect(upState.selection.focus.regionId).toBe(before.id);
  expect(downState.selection.focus.regionId).toBe(after.id);
});

test("extends the selection vertically across a region boundary while keeping the anchor", () => {
  const state = setup("alpha\n\nbeta\n\ngamma");
  const first = getRegion(state, "alpha");
  const second = getRegion(state, "beta");
  const layout = createDocumentLayout(state.documentIndex, { width: 320 });
  const nextState = moveCaretVertically(placeAt(state, first, 2), layout, 1, true);

  expect(nextState.selection.anchor.regionId).toBe(first.id);
  expect(nextState.selection.anchor.offset).toBe(2);
  expect(nextState.selection.focus.regionId).toBe(second.id);
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
  const layout = createDocumentLayout(state.documentIndex, { width: 320 });
  const downState = moveCaretVertically(placeAt(state, region, 1), layout, 1);

  expect(downState.selection.focus.regionId).toBe(region.id);
  // Crossing the soft break advances past the `\n` into the second line.
  expect(downState.selection.focus.offset).toBeGreaterThan(3);

  const upState = moveCaretVertically(downState, layout, -1);

  expect(upState.selection.focus.regionId).toBe(region.id);
  expect(upState.selection.focus.offset).toBeLessThanOrEqual(3);
});

// Inert leaf blocks (divider; future image-as-block, embed, display-math)
// contribute no region. Caret navigation steps over them transparently:
// they don't appear in the region-flow walk for left/right, and they
// don't appear in `layout.lines` so the vertical/page walk passes
// over them by construction. Without these properties a divider would
// create a dead caret stop where typing, Enter, and most commands
// fail with "unsupported".
describe("Dividers", () => {
  test("right arrow at end of paragraph skips the divider and lands at start of the next paragraph", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const alpha = getRegion(state, "alpha");
    const beta = getRegion(state, "beta");

    const next = moveCaretHorizontally(placeAt(state, alpha, "end"), 1);

    expect(next.selection.focus.regionId).toBe(beta.id);
    expect(next.selection.focus.offset).toBe(0);
  });

  test("left arrow at start of paragraph skips the divider and lands at end of the previous paragraph", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const alpha = getRegion(state, "alpha");
    const beta = getRegion(state, "beta");

    const next = moveCaretHorizontally(placeAt(state, beta, "start"), -1);

    expect(next.selection.focus.regionId).toBe(alpha.id);
    expect(next.selection.focus.offset).toBe(alpha.text.length);
  });

  test("down arrow from a paragraph above a divider lands in the paragraph below it", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const alpha = getRegion(state, "alpha");
    const beta = getRegion(state, "beta");
    const layout = createDocumentLayout(state.documentIndex, { width: 320 });

    const next = moveCaretVertically(placeAt(state, alpha, "end"), layout, 1);

    expect(next.selection.focus.regionId).toBe(beta.id);
  });

  test("up arrow from a paragraph below a divider lands in the paragraph above it", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const alpha = getRegion(state, "alpha");
    const beta = getRegion(state, "beta");
    const layout = createDocumentLayout(state.documentIndex, { width: 320 });

    const next = moveCaretVertically(placeAt(state, beta, "start"), layout, -1);

    expect(next.selection.focus.regionId).toBe(alpha.id);
  });
});
