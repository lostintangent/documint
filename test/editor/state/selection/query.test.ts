import { describe, expect, test } from "bun:test";
import {
  getCaretTextContext,
  getSelectionContext,
  getSelectionRange,
  selectionIntersectsBlockPath,
  selectionIntersectsRegion,
  setSelection,
} from "@/editor/state";
import { setup } from "../../helpers";

describe("Selection queries", () => {
  test("derives the active block and span from the selection anchor", () => {
    let state = setup("Paragraph with **strong** text and [link](https://example.com).\n");
    const container = state.documentIndex.regions[0];

    if (!container) {
      throw new Error("Expected container");
    }

    state = setSelection(state, {
      regionPath: container.path,
      offset: container.text.indexOf("strong") + 1,
    });

    const marked = getSelectionContext(state);

    expect(marked.block?.nodeType).toBe("paragraph");
    expect(marked.span.kind).toBe("marks");

    state = setSelection(state, {
      regionPath: container.path,
      offset: container.text.indexOf("link") + 1,
    });

    const linked = getSelectionContext(state);

    expect(linked.span.kind).toBe("link");
    expect(linked.span.kind === "link" ? linked.span.url : null).toBe("https://example.com");
  });

  test("derives a same-region selection range", () => {
    let state = setup("alpha\n\nbeta\n");
    const [first, second] = state.documentIndex.regions;

    if (!first || !second) {
      throw new Error("Expected regions");
    }

    state = setSelection(state, {
      anchor: { regionPath: first.path, offset: 4 },
      focus: { regionPath: first.path, offset: 1 },
    });

    expect(getSelectionRange(state)).toEqual({
      endOffset: 4,
      regionPath: first.path,
      startOffset: 1,
    });

    state = setSelection(state, {
      anchor: { regionPath: first.path, offset: 1 },
      focus: { regionPath: second.path, offset: 1 },
    });

    expect(getSelectionRange(state)).toBeNull();

    state = setSelection(state, {
      regionPath: first.path,
      offset: 1,
    });

    expect(getSelectionRange(state)).toBeNull();
  });

  test("derives caret text context", () => {
    let state = setup("alpha beta\n\ngamma\n");
    const [first, second] = state.documentIndex.regions;

    if (!first || !second) {
      throw new Error("Expected regions");
    }

    state = setSelection(state, {
      regionPath: first.path,
      offset: 6,
    });

    expect(getCaretTextContext(state)).toEqual({
      offset: 6,
      regionPath: first.path,
      text: "alpha beta",
    });

    state = setSelection(state, {
      anchor: { regionPath: first.path, offset: 0 },
      focus: { regionPath: second.path, offset: 1 },
    });

    expect(getCaretTextContext(state)).toBeNull();
  });

  test("checks selection intersection with regions", () => {
    let state = setup("alpha\n\nbeta\n\ngamma\n");
    const [first, second, third] = state.documentIndex.regions;

    if (!first || !second || !third) {
      throw new Error("Expected regions");
    }

    state = setSelection(state, { regionPath: second.path, offset: 0 });

    expect(selectionIntersectsRegion(state, second.path)).toBe(true);
    expect(selectionIntersectsRegion(state, first.path)).toBe(false);
    expect(selectionIntersectsRegion(state, "missing")).toBe(false);

    state = setSelection(state, {
      anchor: { regionPath: first.path, offset: first.text.length },
      focus: { regionPath: second.path, offset: 0 },
    });

    expect(selectionIntersectsRegion(state, first.path)).toBe(true);
    expect(selectionIntersectsRegion(state, second.path)).toBe(true);
    expect(selectionIntersectsRegion(state, third.path)).toBe(false);
  });

  test("checks selection intersection with blocks and descendants", () => {
    let state = setup(`- parent
  - child

outside
`);
    const [parent, child, outside] = state.documentIndex.regions;
    const list = state.documentIndex.document.blocks[0];

    if (!parent || !child || !outside || list?.type !== "list") {
      throw new Error("Expected regions");
    }

    state = setSelection(state, { regionPath: child.path, offset: 0 });

    const listBlockPath = state.documentIndex.blocks.find((entry) => entry.block === list)?.path;

    expect(selectionIntersectsBlockPath(state, child.blockPath)).toBe(true);
    expect(listBlockPath ? selectionIntersectsBlockPath(state, listBlockPath) : false).toBe(true);
    expect(selectionIntersectsBlockPath(state, outside.blockPath)).toBe(false);
    expect(selectionIntersectsBlockPath(state, "missing")).toBe(false);

    state = setSelection(state, {
      anchor: { regionPath: parent.path, offset: 0 },
      focus: { regionPath: outside.path, offset: 1 },
    });

    expect(selectionIntersectsBlockPath(state, child.blockPath)).toBe(true);
  });

  test("checks selection intersection with a fully covered container block", () => {
    let state = setup(`before

- parent
  - child

after
`);
    const [before, parent, child, after] = state.documentIndex.regions;
    const list = state.documentIndex.document.blocks[1];

    if (!before || !parent || !child || !after || list?.type !== "list") {
      throw new Error("Expected list between surrounding paragraphs");
    }

    state = setSelection(state, {
      anchor: { regionPath: before.path, offset: before.text.length },
      focus: { regionPath: after.path, offset: 0 },
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
    const before = state.documentIndex.regions.find((region) => region.text === "before");
    const beta = state.documentIndex.regions.find((region) => region.text === "beta");
    const after = state.documentIndex.regions.find((region) => region.text === "after");

    if (!before || !beta || !after) {
      throw new Error("Expected table and surrounding paragraph regions");
    }

    state = setSelection(state, { regionPath: beta.path, offset: 0 });

    expect(selectionIntersectsBlockPath(state, beta.blockPath)).toBe(true);
    expect(selectionIntersectsBlockPath(state, before.blockPath)).toBe(false);

    state = setSelection(state, {
      anchor: { regionPath: before.path, offset: before.text.length },
      focus: { regionPath: after.path, offset: 0 },
    });

    expect(selectionIntersectsBlockPath(state, beta.blockPath)).toBe(true);
  });
});
