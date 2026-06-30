import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import {
  getCaretTextContext,
  getSelectionContext,
  getSelectionRange,
  selectionIntersectsBlockPath,
  selectionIntersectsPath,
  setSelection,
} from "@/editor/state";
import { setup } from "../../helpers";

describe("Selection queries", () => {
  test("derives the active block and span from the selection anchor", () => {
    let state = setup("Paragraph with **strong** text and [link](https://example.com).\n");
    const container = indexedTextEntries(state)[0];

    if (!container) {
      throw new Error("Expected container");
    }

    state = setSelection(state, {
      path: container.path,
      offset: container.text.indexOf("strong") + 1,
    });

    const marked = getSelectionContext(state);

    expect(marked.block?.nodeType).toBe("paragraph");
    expect(marked.span.kind).toBe("marks");

    state = setSelection(state, {
      path: container.path,
      offset: container.text.indexOf("link") + 1,
    });

    const linked = getSelectionContext(state);

    expect(linked.span.kind).toBe("link");
    expect(linked.span.kind === "link" ? linked.span.url : null).toBe("https://example.com");
  });

  test("derives a same-path selection range", () => {
    let state = setup("alpha\n\nbeta\n");
    const [first, second] = indexedTextEntries(state);

    if (!first || !second) {
      throw new Error("Expected paths");
    }

    state = setSelection(state, {
      anchor: { path: first.path, offset: 4 },
      focus: { path: first.path, offset: 1 },
    });

    expect(getSelectionRange(state)).toEqual({
      endOffset: 4,
      path: first.path,
      startOffset: 1,
    });

    state = setSelection(state, {
      anchor: { path: first.path, offset: 1 },
      focus: { path: second.path, offset: 1 },
    });

    expect(getSelectionRange(state)).toBeNull();

    state = setSelection(state, {
      path: first.path,
      offset: 1,
    });

    expect(getSelectionRange(state)).toBeNull();
  });

  test("derives caret text context", () => {
    let state = setup("alpha beta\n\ngamma\n");
    const [first, second] = indexedTextEntries(state);

    if (!first || !second) {
      throw new Error("Expected paths");
    }

    state = setSelection(state, {
      path: first.path,
      offset: 6,
    });

    expect(getCaretTextContext(state)).toEqual({
      offset: 6,
      path: first.path,
      text: "alpha beta",
    });

    state = setSelection(state, {
      anchor: { path: first.path, offset: 0 },
      focus: { path: second.path, offset: 1 },
    });

    expect(getCaretTextContext(state)).toBeNull();
  });

  test("checks selection intersection with paths", () => {
    let state = setup("alpha\n\nbeta\n\ngamma\n");
    const [first, second, third] = indexedTextEntries(state);

    if (!first || !second || !third) {
      throw new Error("Expected paths");
    }

    state = setSelection(state, { path: second.path, offset: 0 });

    expect(selectionIntersectsPath(state, second.path)).toBe(true);
    expect(selectionIntersectsPath(state, first.path)).toBe(false);
    expect(selectionIntersectsPath(state, "missing")).toBe(false);

    state = setSelection(state, {
      anchor: { path: first.path, offset: first.text.length },
      focus: { path: second.path, offset: 0 },
    });

    expect(selectionIntersectsPath(state, first.path)).toBe(true);
    expect(selectionIntersectsPath(state, second.path)).toBe(true);
    expect(selectionIntersectsPath(state, third.path)).toBe(false);
  });

  test("checks selection intersection with blocks and descendants", () => {
    let state = setup(`- parent
  - child

outside
`);
    const [parent, child, outside] = indexedTextEntries(state);
    const list = state.documentIndex.document.blocks[0];

    if (!parent || !child || !outside || list?.type !== "list") {
      throw new Error("Expected paths");
    }

    state = setSelection(state, { path: child.path, offset: 0 });

    const listBlockPath = state.documentIndex.blocks.find((entry) => entry.block === list)?.path;

    expect(selectionIntersectsBlockPath(state, child.blockPath)).toBe(true);
    expect(listBlockPath ? selectionIntersectsBlockPath(state, listBlockPath) : false).toBe(true);
    expect(selectionIntersectsBlockPath(state, outside.blockPath)).toBe(false);
    expect(selectionIntersectsBlockPath(state, "missing")).toBe(false);

    state = setSelection(state, {
      anchor: { path: parent.path, offset: 0 },
      focus: { path: outside.path, offset: 1 },
    });

    expect(selectionIntersectsBlockPath(state, child.blockPath)).toBe(true);
  });

  test("checks selection intersection with a fully covered container block", () => {
    let state = setup(`before

- parent
  - child

after
`);
    const [before, parent, child, after] = indexedTextEntries(state);
    const list = state.documentIndex.document.blocks[1];

    if (!before || !parent || !child || !after || list?.type !== "list") {
      throw new Error("Expected list between surrounding paragraphs");
    }

    state = setSelection(state, {
      anchor: { path: before.path, offset: before.text.length },
      focus: { path: after.path, offset: 0 },
    });

    const listBlockPath = state.documentIndex.blocks.find((entry) => entry.block === list)?.path;

    expect(listBlockPath ? selectionIntersectsBlockPath(state, listBlockPath) : false).toBe(true);
  });

  test("checks selection intersection with table cell blocks", () => {
    let state = setup(`before

| A | B |
| - | - |
| alpha | beta |

after
`);
    const before = indexedTextEntries(state).find((path) => path.text === "before");
    const beta = indexedTextEntries(state).find((path) => path.text === "beta");
    const after = indexedTextEntries(state).find((path) => path.text === "after");

    if (!before || !beta || !after) {
      throw new Error("Expected table and surrounding paragraph paths");
    }

    state = setSelection(state, { path: beta.path, offset: 0 });

    expect(selectionIntersectsBlockPath(state, beta.blockPath)).toBe(true);
    expect(selectionIntersectsBlockPath(state, before.blockPath)).toBe(false);

    state = setSelection(state, {
      anchor: { path: before.path, offset: before.text.length },
      focus: { path: after.path, offset: 0 },
    });

    expect(selectionIntersectsBlockPath(state, beta.blockPath)).toBe(true);
  });
});
