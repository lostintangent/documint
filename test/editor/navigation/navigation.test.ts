import { indexedTextEntries } from "@test/editor/helpers";
import { expect, test } from "bun:test";
import {
  extendSelectionToPoint,
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
  type EditorState,
} from "@/editor";
import { setSelection, type DocumentIndex } from "@/editor/state";
import { getPath, placeAt, setup } from "../helpers";

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
  const heading = getPath(state, "Heading");
  const paragraph = getPath(state, "Paragraph");
  const nextState = moveCaretHorizontally(placeAt(state, paragraph, "start"), -1);

  expect(nextState.selection.focus.path).toBe(heading.path);
  expect(nextState.selection.focus.offset).toBe(heading.text.length);
});

test("moves right to the next container when the caret is at the end", () => {
  const state = setup("# Heading\n\nParagraph");
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

test("moves and extends the caret by word", () => {
  const state = setup("alpha, beta gamma");
  const path = getPath(state, "alpha, beta gamma");
  const placed = placeAt(state, path, "start");
  const moved = moveCaretByWord(placed, 1);
  const extended = moveCaretByWord(moved, 1, { extendSelection: true });

  expect(moved.selection.focus.offset).toBe("alpha".length);
  expect(extended.selection.anchor).toEqual(moved.selection.focus);
  expect(extended.selection.focus.offset).toBe("alpha, beta".length);
  expect(extended.documentIndex).toBe(state.documentIndex);
});

test("collapses existing word selections toward the movement direction", () => {
  const state = setup("alpha beta gamma");
  const path = getPath(state, "alpha beta gamma");
  const selected = setSelection(state, {
    anchor: { path: path.path, offset: "alpha beta".length },
    focus: { path: path.path, offset: "alpha".length },
  });

  expect(moveCaretByWord(selected, -1).selection.focus.offset).toBe("alpha".length);
  expect(moveCaretByWord(selected, 1).selection.focus.offset).toBe("alpha beta".length);
});

test("moves by word across paths while skipping empty paths", () => {
  const state = setup("alpha\n\n\n\nbeta");
  const entries = indexedTextEntries(state);
  const alpha = entries.find((entry) => entry.text === "alpha");
  const beta = entries.find((entry) => entry.text === "beta");

  if (!alpha || !beta) {
    throw new Error("Expected text paths around empty paragraphs");
  }

  const forward = moveCaretByWord(placeAt(state, alpha, "end"), 1);
  const backward = moveCaretByWord(placeAt(state, beta, "start"), -1);

  expect(forward.selection.focus).toEqual({ path: beta.path, offset: beta.text.length });
  expect(backward.selection.focus).toEqual({ path: alpha.path, offset: 0 });
});

test("uses path navigation for word gestures in block mode", () => {
  const state = setup("alpha beta\n\ngamma delta");
  const first = getPath(state, "alpha beta");
  const second = getPath(state, "gamma delta");
  const moved = moveCaretByWord(placeAt(state, first, 2), 1, { mode: "block" });

  expect(moved.selection.focus).toEqual({ path: second.path, offset: 0 });
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
  const before = requirePathByText(state.documentIndex, "before");
  const firstCell = requirePathByText(state.documentIndex, "A");
  const secondCell = requirePathByText(state.documentIndex, "B");
  const lastCell = requirePathByText(state.documentIndex, "D");
  const after = requirePathByText(state.documentIndex, "after");

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

function requirePathByText(documentIndex: DocumentIndex, text: string) {
  for (const indexedBlock of documentIndex.blocks) {
    if (
      (indexedBlock.kind === "inlines" || indexedBlock.kind === "source") &&
      indexedBlock.text === text
    ) {
      return indexedBlock.path;
    }

    if (indexedBlock.kind === "cells") {
      for (const row of indexedBlock.tableCellRows) {
        for (const cell of row) {
          if (cell.text === text) {
            return cell.path;
          }
        }
      }
    }
  }

  throw new Error(`Expected editor path with text "${text}"`);
}
