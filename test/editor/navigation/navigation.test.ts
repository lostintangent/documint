import { describe, expect, test } from "bun:test";
import {
  extendSelectionToPoint,
  moveCaretByViewport,
  moveCaretByWord,
  moveCaretHorizontally,
  moveCaretToDocumentBoundary,
  moveCaretToLineBoundary,
  moveCaretVertically,
} from "@/editor/navigation";
import {
  createEditorLayoutState,
  createLayoutCache,
  resolveSelectionPointAt,
  type EditorLayoutState,
  type EditorState,
} from "@/editor";
import { metadataValuePath, readEditorEffects, setSelection } from "@/editor/state";
import { getPath, indexedTextEntries, placeAt, setup } from "../helpers";

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

test("moves left to the previous container, skipping inert blocks, when the caret is at the start", () => {
  const state = setup("# Heading\n\n---\n\nParagraph");
  const heading = getPath(state, "Heading");
  const paragraph = getPath(state, "Paragraph");
  const nextState = moveCaretHorizontally(placeAt(state, paragraph, "start"), -1);

  expect(nextState.selection.focus.path).toBe(heading.path);
  expect(nextState.selection.focus.offset).toBe(heading.text.length);
});

test("moves right to the next container, skipping inert blocks, when the caret is at the end", () => {
  const state = setup("# Heading\n\n---\n\nParagraph");
  const heading = getPath(state, "Heading");
  const paragraph = getPath(state, "Paragraph");
  const nextState = moveCaretHorizontally(placeAt(state, heading, "end"), 1);

  expect(nextState.selection.focus.path).toBe(paragraph.path);
  expect(nextState.selection.focus.offset).toBe(0);
});

test("extends the selection to the left when shift-arrow-left is used repeatedly", () => {
  const state = setup("alpha");
  const path = getPath(state, "alpha");
  const once = moveCaretHorizontally(placeAt(state, path, 4), -1, {
    extendSelection: true,
  });
  const twice = moveCaretHorizontally(once, -1, { extendSelection: true });

  expect(once.selection.anchor.offset).toBe(4);
  expect(once.selection.focus.offset).toBe(3);
  expect(twice.selection.anchor.offset).toBe(4);
  expect(twice.selection.focus.offset).toBe(2);
});

test("extends the selection across paths when shift-arrow-right crosses a boundary", () => {
  const state = setup("alpha\n\nbeta");
  const first = getPath(state, "alpha");
  const second = getPath(state, "beta");
  const nextState = moveCaretHorizontally(placeAt(state, first, "end"), 1, {
    extendSelection: true,
  });

  expect(nextState.selection.anchor.path).toBe(first.path);
  expect(nextState.selection.anchor.offset).toBe(first.text.length);
  expect(nextState.selection.focus.path).toBe(second.path);
  expect(nextState.selection.focus.offset).toBe(0);
});

test("moves horizontally across images as atomic inline objects", () => {
  const state = setup("before ![alt](https://example.com/image.png) after\n");
  const container = indexedTextEntries(state)[0];

  if (!container) {
    throw new Error("Expected paragraph container");
  }

  const imageRun = (container.inlines ?? []).find((run) => run.node.type === "image");

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
  const path = getPath(state, "a ✈️ b");
  const emojiStart = path.text.indexOf("✈️");
  const emojiEnd = emojiStart + "✈️".length;
  const afterLeft = moveCaretHorizontally(placeAt(state, path, emojiEnd), -1);
  const afterRight = moveCaretHorizontally(placeAt(state, path, emojiStart), 1);

  expect(afterLeft.selection.focus.offset).toBe(emojiStart);
  expect(afterRight.selection.focus.offset).toBe(emojiEnd);
});

test("extends horizontal selections by grapheme clusters", () => {
  const state = setup("a ✈️ b");
  const path = getPath(state, "a ✈️ b");
  const emojiStart = path.text.indexOf("✈️");
  const emojiEnd = emojiStart + "✈️".length;
  const next = moveCaretHorizontally(placeAt(state, path, emojiEnd), -1, {
    extendSelection: true,
  });

  expect(next.selection.anchor.offset).toBe(emojiEnd);
  expect(next.selection.focus.offset).toBe(emojiStart);
});

test("extends the selection to the start of the current line", () => {
  const state = setup("alpha beta gamma");
  const container = getPath(state, "alpha beta gamma");
  const layout = layoutAt(state, 90);
  const nextState = moveCaretToLineBoundary(placeAt(state, container, "end"), layout, "Home", {
    extendSelection: true,
  });

  expect(nextState.selection.anchor.path).toBe(container.path);
  expect(nextState.selection.anchor.offset).toBe(container.text.length);
  expect(nextState.selection.focus.path).toBe(container.path);
  expect(nextState.selection.focus.offset).toBeGreaterThan(0);
  expect(nextState.selection.focus.offset).toBeLessThan(container.text.length);
});

test("extends the selection to the end of the current line", () => {
  const state = setup("alpha beta gamma");
  const container = getPath(state, "alpha beta gamma");
  const layout = layoutAt(state, 90);
  const nextState = moveCaretToLineBoundary(placeAt(state, container, "start"), layout, "End", {
    extendSelection: true,
  });

  expect(nextState.selection.anchor.path).toBe(container.path);
  expect(nextState.selection.anchor.offset).toBe(0);
  expect(nextState.selection.focus.path).toBe(container.path);
  expect(nextState.selection.focus.offset).toBeGreaterThan(0);
  expect(nextState.selection.focus.offset).toBeLessThan(container.text.length);
});

test("moves vertically between table cells in the same column", () => {
  const state = setup("| A | B |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |");
  const beta = getPath(state, "beta");
  const headerB = getPath(state, "B");
  const delta = getPath(state, "delta");
  const layout = layoutAt(state, 420);
  const upState = moveCaretVertically(placeAt(state, beta, 2), layout, -1);

  expect(upState.selection.focus.path).toBe(headerB.path);

  const downState = moveCaretVertically(placeAt(state, beta, 2), layout, 1);

  expect(downState.selection.focus.path).toBe(delta.path);
});

test("moves horizontally across table cells and out of the table", () => {
  const state = setup("before\n\n| A | B |\n| --- | --- |\n| C | D |\n\nafter");
  const before = getPath(state, "before").path;
  const firstCell = getPath(state, "A").path;
  const secondCell = getPath(state, "B").path;
  const lastCell = getPath(state, "D").path;
  const after = getPath(state, "after").path;

  const toPrevious = moveCaretHorizontally(setSelection(state, { offset: 0, path: firstCell }), -1);
  const toSecondCell = moveCaretHorizontally(
    setSelection(state, { offset: 1, path: firstCell }),
    1,
  );
  const outOfTable = moveCaretHorizontally(setSelection(state, { offset: 1, path: lastCell }), 1);

  expect(toPrevious.selection.focus).toEqual({ offset: "before".length, path: before });
  expect(toSecondCell.selection.focus).toEqual({ offset: 0, path: secondCell });
  expect(outOfTable.selection.focus).toEqual({ offset: 0, path: after });
});

test("moves horizontally by path in block navigation mode", () => {
  const state = setup("alpha\n\nbeta\n\ngamma");
  const alpha = getPath(state, "alpha");
  const beta = getPath(state, "beta");
  const gamma = getPath(state, "gamma");

  const rightState = moveCaretHorizontally(placeAt(state, alpha, 2), 1, { mode: "block" });
  const leftState = moveCaretHorizontally(placeAt(state, gamma, 3), -1, { mode: "block" });

  expect(rightState.selection.focus).toEqual({ offset: 0, path: beta.path });
  expect(leftState.selection.focus).toEqual({ offset: 0, path: beta.path });
});

test("moves vertically by table cell in block navigation mode", () => {
  const state = setup("| A | B |\n| --- | --- |\n| alpha | beta |\n| gamma | delta |");
  const beta = getPath(state, "beta");
  const headerB = getPath(state, "B");
  const delta = getPath(state, "delta");
  const layout = layoutAt(state, 420);

  const upState = moveCaretVertically(placeAt(state, beta, 2), layout, -1, { mode: "block" });
  const downState = moveCaretVertically(placeAt(state, beta, 2), layout, 1, { mode: "block" });

  expect(upState.selection.focus).toEqual({ offset: 0, path: headerB.path });
  expect(downState.selection.focus).toEqual({ offset: 0, path: delta.path });
});

test("extends block navigation selections by whole paths", () => {
  const state = setup("alpha\n\nbeta\n\ngamma");
  const alpha = getPath(state, "alpha");
  const beta = getPath(state, "beta");
  const layout = layoutAt(state, 320);
  const nextState = moveCaretVertically(placeAt(state, alpha, 2), layout, 1, {
    extendSelection: true,
    mode: "block",
  });

  expect(nextState.selection.anchor).toEqual({ offset: 0, path: alpha.path });
  expect(nextState.selection.focus).toEqual({ offset: beta.text.length, path: beta.path });
});

test("moves out of a table when there is no row above or below", () => {
  const state = setup("before\n\n| A | B |\n| --- | --- |\n| alpha | beta |\n\nafter");
  const headerB = getPath(state, "B");
  const beta = getPath(state, "beta");
  const before = getPath(state, "before");
  const after = getPath(state, "after");
  const layout = layoutAt(state, 420);
  const upState = moveCaretVertically(placeAt(state, headerB, 1), layout, -1);
  const downState = moveCaretVertically(placeAt(state, beta, 1), layout, 1);

  expect(upState.selection.focus.path).toBe(before.path);
  expect(downState.selection.focus.path).toBe(after.path);
});

test("moves vertically out of a nested table to sibling paths in the same root", () => {
  const state = setup("> before\n>\n> | A | B |\n> | --- | --- |\n> | alpha | beta |\n>\n> after");
  const headerB = getPath(state, "B");
  const beta = getPath(state, "beta");
  const before = getPath(state, "before");
  const after = getPath(state, "after");
  const layout = layoutAt(state, 420);

  const upState = moveCaretVertically(placeAt(state, headerB, 1), layout, -1);
  const downState = moveCaretVertically(placeAt(state, beta, 1), layout, 1);

  expect(upState.selection.focus.path).toBe(before.path);
  expect(downState.selection.focus.path).toBe(after.path);
});

test("extends the selection vertically across a path boundary while keeping the anchor", () => {
  const state = setup("alpha\n\nbeta\n\ngamma");
  const first = getPath(state, "alpha");
  const second = getPath(state, "beta");
  const layout = layoutAt(state, 320);
  const nextState = moveCaretVertically(placeAt(state, first, 2), layout, 1, {
    extendSelection: true,
  });

  expect(nextState.selection.anchor.path).toBe(first.path);
  expect(nextState.selection.anchor.offset).toBe(2);
  expect(nextState.selection.focus.path).toBe(second.path);
});

test.each([
  ["a fully measured", 20],
  ["a virtualized", 120],
])("pages by pixels rather than lines in %s layout", (_, paragraphs) => {
  const state = setup(
    Array.from({ length: paragraphs }, (_, index) => `p${index + 1}`).join("\n\n"),
  );
  const [p6, p11] = [getPath(state, "p6"), getPath(state, "p11")];
  // Ten lines tall, but each paragraph's gap makes it taller than a line, so a
  // page moves five paragraphs rather than nine lines.
  const viewport = createEditorLayoutState(
    state,
    { height: 240, top: 0, width: 320 },
    createLayoutCache(),
  );
  const down = moveCaretByViewport(placeAt(state, p6, 1), viewport, 1, true);
  const up = moveCaretByViewport(placeAt(state, p11, 1), viewport, -1);

  expect(down.selection.anchor).toEqual({ offset: 1, path: p6.path });
  expect(down.selection.focus.path).toBe(p11.path);
  expect(up.selection.focus.path).toBe(p6.path);
});

test.each([
  ["down from a body line", "p0", 1, "p1"],
  ["up from a heading", "H2", -1, "H1"],
] as const)("pages %s to the farthest line that fits with it", (_, from, direction, to) => {
  // A 220px page fits p0 through p1 (156px) but not through H2 (224px), and H2
  // through H1 (168px) but not through p0 (224px), once both lines' heights count.
  const state = setup("# H0\n\np0\n\n# H1\n\np1\n\n# H2");
  const viewport = createEditorLayoutState(
    state,
    { height: 220, top: 0, width: 320 },
    createLayoutCache(),
  );
  const next = moveCaretByViewport(placeAt(state, getPath(state, from), 0), viewport, direction);

  expect(next.selection.focus.path).toBe(getPath(state, to).path);
});

test("pages to the first or last line, keeping the caret's x, when less than a page remains", () => {
  const state = setup("one\n\ntwo\n\nthree\n\nfour");
  const layout = layoutAt(state, 320);
  const viewport = {
    ...layout,
    viewport: { ...layout.viewport, height: layout.layout.options.lineHeight * 3 },
  };
  const down = moveCaretByViewport(placeAt(state, getPath(state, "three"), 2), viewport, 1);
  const up = moveCaretByViewport(placeAt(state, getPath(state, "two"), 1), viewport, -1);

  expect(down.selection.focus).toEqual({ offset: 2, path: getPath(state, "four").path });
  expect(up.selection.focus).toEqual({ offset: 1, path: getPath(state, "one").path });
});

test("extends the selection to a viewport point while keeping the anchor", () => {
  const state = setup("Hello world\n");
  const path = getPath(state, "Hello world");
  const placed = placeAt(state, path, 0);
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
  const hit = resolveSelectionPointAt(placed, viewport, point);
  const extended = extendSelectionToPoint(placed, viewport, point);

  expect(hit).not.toBeNull();
  expect(extended).not.toBeNull();
  expect(extended!.selection.anchor).toEqual({ offset: 0, path: path.path });
  expect(extended!.selection.focus).toEqual({
    offset: hit!.offset,
    path: hit!.path,
  });
});

test("jumps to the start of the document when moveCaretToDocumentBoundary is invoked with start", () => {
  const state = setup("alpha\n\nbeta\n\ngamma");
  const first = getPath(state, "alpha");
  const third = getPath(state, "gamma");
  const nextState = moveCaretToDocumentBoundary(placeAt(state, third, 2), "start");

  expect(nextState.selection.anchor).toEqual({ offset: 0, path: first.path });
  expect(nextState.selection.focus).toEqual({ offset: 0, path: first.path });
});

test("jumps to the end of the document when moveCaretToDocumentBoundary is invoked with end", () => {
  const state = setup("alpha\n\nbeta\n\ngamma");
  const first = getPath(state, "alpha");
  const third = getPath(state, "gamma");
  const nextState = moveCaretToDocumentBoundary(placeAt(state, first, "start"), "end");

  expect(nextState.selection.anchor).toEqual({
    offset: third.text.length,
    path: third.path,
  });
  expect(nextState.selection.focus).toEqual({
    offset: third.text.length,
    path: third.path,
  });
});

test("moves metadata selection to an inert document boundary", () => {
  const state = setup("---\ntitle: Draft\n---\n\n***\n");
  const divider = state.documentIndex.blocks.find((entry) => entry.block.type === "divider");

  if (!divider) {
    throw new Error("Expected divider");
  }

  const nextState = moveCaretToDocumentBoundary(
    setSelection(state, { path: metadataValuePath(0), offset: 2 }),
    "start",
  );

  expect(nextState.selection.focus).toEqual({ path: divider.path, offset: 0 });
});

test("extends the selection to the end of the document while keeping the anchor", () => {
  const state = setup("alpha\n\nbeta\n\ngamma");
  const first = getPath(state, "alpha");
  const third = getPath(state, "gamma");
  const nextState = moveCaretToDocumentBoundary(placeAt(state, first, 2), "end", true);

  expect(nextState.selection.anchor).toEqual({ offset: 2, path: first.path });
  expect(nextState.selection.focus).toEqual({
    offset: third.text.length,
    path: third.path,
  });
});

test("moves vertically across an inline soft break inside one paragraph", () => {
  // A paragraph with an inline `<br>` is laid out as two visual lines but
  // remains one path. Vertical navigation must walk between those lines
  // by changing the offset within the same path (rather than crossing a
  // path boundary), which also exercises the layout-driven caret math
  // for `\n` segments.
  const state = setup("foo<br>bar\n");
  const path = getPath(state, "foo\nbar");
  const layout = layoutAt(state, 320);
  const downState = moveCaretVertically(placeAt(state, path, 1), layout, 1);

  expect(downState.selection.focus.path).toBe(path.path);
  // Crossing the soft break advances past the `\n` into the second line.
  expect(downState.selection.focus.offset).toBeGreaterThan(3);

  const upState = moveCaretVertically(downState, layout, -1);

  expect(upState.selection.focus.path).toBe(path.path);
  expect(upState.selection.focus.offset).toBeLessThanOrEqual(3);
});

describe("unextended moves from a selection", () => {
  type Move = (state: EditorState, layout: EditorLayoutState) => EditorState;

  test.each<[string, "start" | "end", Move]>([
    ["ArrowLeft", "start", (state) => moveCaretHorizontally(state, -1)],
    ["ArrowRight", "end", (state) => moveCaretHorizontally(state, 1)],
    [
      "ArrowLeft in block mode",
      "start",
      (state) => moveCaretHorizontally(state, -1, { mode: "block" }),
    ],
    [
      "ArrowRight in block mode",
      "end",
      (state) => moveCaretHorizontally(state, 1, { mode: "block" }),
    ],
    [
      "a word move in block mode",
      "end",
      (state) => moveCaretByWord(state, "wordEnd", { mode: "block" }),
    ],
  ])("%s collapses it to its %s", (_, edge, move) => {
    const state = setup("alpha\n\nbeta\n\ngamma");
    const start = { offset: 1, path: getPath(state, "alpha").path };
    const end = { offset: 2, path: getPath(state, "beta").path };
    const layout = layoutAt(state, 320);

    for (const [anchor, focus] of [
      [start, end],
      [end, start],
    ] as const) {
      const next = move(setSelection(state, { anchor, focus }), layout);

      expect(next.selection).toEqual({
        anchor: edge === "start" ? start : end,
        focus: edge === "start" ? start : end,
      });
    }
  });

  test.each<[string, string, Move]>([
    ["ArrowUp", "alpha", (state, layout) => moveCaretVertically(state, layout, -1)],
    ["ArrowDown", "delta", (state, layout) => moveCaretVertically(state, layout, 1)],
    ["PageUp", "alpha", (state, layout) => moveCaretByViewport(state, oneLinePage(layout), -1)],
    ["PageDown", "delta", (state, layout) => moveCaretByViewport(state, oneLinePage(layout), 1)],
    ["Home", "beta", (state, layout) => moveCaretToLineBoundary(state, layout, "Home")],
    ["End", "gamma", (state, layout) => moveCaretToLineBoundary(state, layout, "End")],
    [
      "ArrowUp in block mode",
      "alpha",
      (state, layout) => moveCaretVertically(state, layout, -1, { mode: "block" }),
    ],
    [
      "ArrowDown in block mode",
      "delta",
      (state, layout) => moveCaretVertically(state, layout, 1, { mode: "block" }),
    ],
    [
      "Home in block mode",
      "beta",
      (state, layout) => moveCaretToLineBoundary(state, layout, "Home", { mode: "block" }),
    ],
    [
      "End in block mode",
      "gamma",
      (state, layout) => moveCaretToLineBoundary(state, layout, "End", { mode: "block" }),
    ],
  ])("%s moves from its edge in that direction to %s", (_, target, move) => {
    const state = setup("alpha\n\nbeta\n\ngamma\n\ndelta");
    const start = { offset: 1, path: getPath(state, "beta").path };
    const end = { offset: 2, path: getPath(state, "gamma").path };
    const layout = layoutAt(state, 320);

    for (const [anchor, focus] of [
      [start, end],
      [end, start],
    ] as const) {
      const next = move(setSelection(state, { anchor, focus }), layout);

      expect(next.selection.focus.path).toBe(getPath(state, target).path);
      expect(next.selection.anchor).toEqual(next.selection.focus);
    }
  });

  test("flashes the block a vertical move lands in when it leaves the selection's focus block", () => {
    const state = setup("foo<br>bar\n\nnext");
    const paragraph = getPath(state, "foo\nbar");
    const selected = setSelection(state, {
      anchor: { offset: 5, path: paragraph.path },
      focus: { offset: 2, path: getPath(state, "next").path },
    });
    const next = moveCaretVertically(selected, layoutAt(state, 320), -1);

    expect(next.selection.focus).toEqual({ offset: 1, path: paragraph.path });
    expect(readEditorEffects(next)).toEqual([
      { blockPath: paragraph.path, kind: "active-block-changed" },
    ]);
  });

  function oneLinePage(layout: EditorLayoutState) {
    return { ...layout, viewport: { ...layout.viewport, height: 0 } };
  }
});
