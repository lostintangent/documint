import { describe, expect, test } from "bun:test";
import {
  getCaretTextContext,
  getSelectionContext,
  getSelectionRange,
  selectionIntersectsBlock,
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
      regionId: container.id,
      offset: container.text.indexOf("strong") + 1,
    });

    const marked = getSelectionContext(state);

    expect(marked.block?.nodeType).toBe("paragraph");
    expect(marked.span.kind).toBe("marks");

    state = setSelection(state, {
      regionId: container.id,
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
      anchor: { regionId: first.id, offset: 4 },
      focus: { regionId: first.id, offset: 1 },
    });

    expect(getSelectionRange(state)).toEqual({
      endOffset: 4,
      regionId: first.id,
      startOffset: 1,
    });

    state = setSelection(state, {
      anchor: { regionId: first.id, offset: 1 },
      focus: { regionId: second.id, offset: 1 },
    });

    expect(getSelectionRange(state)).toBeNull();

    state = setSelection(state, {
      regionId: first.id,
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
      regionId: first.id,
      offset: 6,
    });

    expect(getCaretTextContext(state)).toEqual({
      offset: 6,
      regionId: first.id,
      text: "alpha beta",
    });

    state = setSelection(state, {
      anchor: { regionId: first.id, offset: 0 },
      focus: { regionId: second.id, offset: 1 },
    });

    expect(getCaretTextContext(state)).toBeNull();
  });

  test("checks selection intersection with regions", () => {
    let state = setup("alpha\n\nbeta\n\ngamma\n");
    const [first, second, third] = state.documentIndex.regions;

    if (!first || !second || !third) {
      throw new Error("Expected regions");
    }

    state = setSelection(state, { regionId: second.id, offset: 0 });

    expect(selectionIntersectsRegion(state, second.id)).toBe(true);
    expect(selectionIntersectsRegion(state, first.id)).toBe(false);
    expect(selectionIntersectsRegion(state, "missing")).toBe(false);

    state = setSelection(state, {
      anchor: { regionId: first.id, offset: first.text.length },
      focus: { regionId: second.id, offset: 0 },
    });

    expect(selectionIntersectsRegion(state, first.id)).toBe(true);
    expect(selectionIntersectsRegion(state, second.id)).toBe(true);
    expect(selectionIntersectsRegion(state, third.id)).toBe(false);
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

    state = setSelection(state, { regionId: child.id, offset: 0 });

    expect(selectionIntersectsBlock(state, child.block.id)).toBe(true);
    expect(selectionIntersectsBlock(state, list.id)).toBe(true);
    expect(selectionIntersectsBlock(state, outside.block.id)).toBe(false);
    expect(selectionIntersectsBlock(state, "missing")).toBe(false);

    state = setSelection(state, {
      anchor: { regionId: parent.id, offset: 0 },
      focus: { regionId: outside.id, offset: 1 },
    });

    expect(selectionIntersectsBlock(state, child.block.id)).toBe(true);
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
      anchor: { regionId: before.id, offset: before.text.length },
      focus: { regionId: after.id, offset: 0 },
    });

    expect(selectionIntersectsBlock(state, list.id)).toBe(true);
  });
});
