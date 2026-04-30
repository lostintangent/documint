import { describe, expect, test } from "bun:test";
import {
  reconcileExternalContentChange,
  resolveEquivalentSelection,
  restoreEquivalentSelection,
} from "@/component/lib/reconciliation";
import {
  createEditorState,
  createRootPrimaryRegionTarget,
  resolveSelectionTarget,
  setSelection,
  type EditorSelection,
  type EditorState,
} from "@/editor/state";
import { createParagraphTextBlock, spliceDocument } from "@/document";
import { parseDocument } from "@/markdown";

describe("selection reconciliation", () => {
  test("preserves a collapsed cursor when the equivalent region survives", () => {
    const previousState = selectRegionText(
      createState("Alpha paragraph\n\nTarget paragraph\n"),
      1,
      6,
      6,
    );
    const nextState = createState("Edited alpha paragraph\n\nTarget paragraph\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [1, 6],
      focus: [1, 6],
    });
  });

  test("preserves a range selection when both endpoints resolve", () => {
    const previousState = selectRegionText("Alpha paragraph\n\nTarget paragraph\n", 1, 2, 8);
    const nextState = createState("Alpha paragraph\n\nTarget paragraph extended\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [1, 2],
      focus: [1, 8],
    });
  });

  test("preserves a selection across regions during unrelated external edits", () => {
    const previousState = selectRegionRange(
      "First paragraph\n\nSecond paragraph\n\nThird paragraph\n",
      0,
      6,
      1,
      6,
    );
    const nextState = createState(
      "Intro paragraph\n\nFirst paragraph\n\nSecond paragraph\n\nThird paragraph\n",
    );

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [1, 6],
      focus: [2, 6],
    });
  });

  test("clamps the restored cursor when a matched region becomes shorter", () => {
    const previousState = selectRegionText("Alpha paragraph\n", 0, 12, 12);
    const nextState = createState("Alpha\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 5],
      focus: [0, 5],
    });
  });

  test("returns null when the selected region cannot be matched", () => {
    const previousState = selectRegionText("Alpha paragraph\n\nTarget paragraph\n", 1, 4, 4);
    const nextState = createState("Alpha paragraph\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("does not guess when text matching is ambiguous", () => {
    const previousState = selectRegionText(
      "Alpha paragraph\n\nBeta paragraph\n\nTarget paragraph\n",
      2,
      4,
      4,
    );
    const nextState = createState("Target paragraph\n\nTarget paragraph\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });
});

describe("offset reconciliation", () => {
  test("moves a collapsed cursor forward when text is inserted before it", () => {
    const previousState = selectRegionText("Alpha target omega\n", 0, 12, 12);
    const nextState = createState("Alpha inserted target omega\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 21],
      focus: [0, 21],
    });
  });

  test("moves a collapsed cursor backward when text before it is deleted", () => {
    const previousState = selectRegionText("Alpha removed target omega\n", 0, 20, 20);
    const nextState = createState("Alpha target omega\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 12],
      focus: [0, 12],
    });
  });

  test("keeps a collapsed cursor stable when only text after it changes", () => {
    const previousState = selectRegionText("Alpha target omega\n", 0, 12, 12);
    const nextState = createState("Alpha target revised omega\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 12],
      focus: [0, 12],
    });
  });

  test("moves a range selection when text is inserted before the range", () => {
    const previousState = selectRegionText("Alpha target omega\n", 0, 6, 12);
    const nextState = createState("Alpha inserted target omega\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 15],
      focus: [0, 21],
    });
  });

  test("expands a range selection when text is inserted inside the selected text", () => {
    const previousState = selectRegionText("The quick brown fox\n", 0, 4, 15);
    const nextState = createState("The quick red brown fox\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 4],
      focus: [0, 19],
    });
  });

  test("shrinks a range selection when text is deleted inside the selected text", () => {
    const previousState = selectRegionText("The quick red brown fox\n", 0, 4, 19);
    const nextState = createState("The quick brown fox\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 4],
      focus: [0, 15],
    });
  });

  test("collapses a range selection when the selected text is deleted", () => {
    const previousState = selectRegionText("The quick brown fox\n", 0, 4, 15);
    const nextState = createState("The  fox\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 4],
      focus: [0, 4],
    });
  });
});

describe("state restoration", () => {
  test("restores selection without starting an active block flash", () => {
    const previousState = selectRegionText(
      createState("Alpha paragraph\n\nTarget paragraph\n"),
      1,
      6,
      6,
    );
    const nextState = createState("Edited alpha paragraph\n\nTarget paragraph\n");
    const restoredState = restoreEquivalentSelection(previousState, nextState);

    expectSelection(restoredState?.selection ?? null, nextState, {
      anchor: [1, 6],
      focus: [1, 6],
    });
    expect(restoredState?.animations).toEqual([]);
  });
});

describe("external content reconciliation", () => {
  test("recreates a missing empty paragraph before a reconciled following block", () => {
    expectTransientEmptyParagraphReconciliation({
      nextMarkdown: "Alpha paragraph\n",
      previousMarkdown: "Alpha paragraph\n",
      regions: ["", "Alpha paragraph"],
      selectionRegionIndex: 0,
      transientRootIndex: 0,
    });
  });

  test("recreates a missing final empty paragraph and keeps the cursor inside it", () => {
    expectTransientEmptyParagraphReconciliation({
      nextMarkdown: "Alpha paragraph edited\n",
      previousMarkdown: "Alpha paragraph\n",
      regions: ["Alpha paragraph edited", ""],
      selectionRegionIndex: 1,
      transientRootIndex: 1,
    });
  });

  test("recreates a missing empty paragraph between reconciled neighboring blocks", () => {
    expectTransientEmptyParagraphReconciliation({
      nextMarkdown: "Alpha paragraph edited\n\nBeta paragraph\n",
      previousMarkdown: "Alpha paragraph\n\nBeta paragraph\n",
      regions: ["Alpha paragraph edited", "", "Beta paragraph"],
      selectionRegionIndex: 1,
      transientRootIndex: 1,
    });
  });

  test("recreates a missing empty paragraph after a reconciled task list root", () => {
    expectTransientEmptyParagraphReconciliation({
      nextMarkdown: "Alpha paragraph edited\n\n- [ ] task one\n- [x] task two\n",
      previousMarkdown: "Alpha paragraph\n\n- [ ] task one\n- [x] task two\n",
      regions: ["Alpha paragraph edited", "task one", "task two", ""],
      selectionRegionIndex: 3,
      transientRootIndex: 2,
    });
  });
});

function createState(markdown: string) {
  return createEditorState(parseDocument(markdown));
}

function insertTransientEmptyRootParagraph(markdown: string, rootIndex: number) {
  const state = createState(markdown);
  const nextDocument = spliceDocument(state.documentIndex.document, rootIndex, 0, [
    createParagraphTextBlock({ text: "" }),
  ]);
  const nextState = createEditorState(nextDocument);
  const selection = resolveSelectionTarget(
    nextState.documentIndex,
    createRootPrimaryRegionTarget(rootIndex),
  );

  if (!selection) {
    throw new Error(`Missing inserted empty paragraph at root index ${rootIndex}`);
  }

  return setSelection(nextState, selection);
}

function expectTransientEmptyParagraphReconciliation({
  nextMarkdown,
  previousMarkdown,
  regions,
  selectionRegionIndex,
  transientRootIndex,
}: {
  nextMarkdown: string;
  previousMarkdown: string;
  regions: string[];
  selectionRegionIndex: number;
  transientRootIndex: number;
}) {
  expectExternalReconciliation({
    nextMarkdown,
    previousState: insertTransientEmptyRootParagraph(previousMarkdown, transientRootIndex),
    regions,
    selection: {
      anchor: [selectionRegionIndex, 0],
      focus: [selectionRegionIndex, 0],
    },
  });
}

function expectRegions(state: EditorState, expectedText: string[]) {
  expect(state.documentIndex.regions.map((region) => region.text)).toEqual(expectedText);
}

function expectExternalReconciliation({
  nextMarkdown,
  previousState,
  regions,
  selection,
}: {
  nextMarkdown: string;
  previousState: EditorState;
  regions: string[];
  selection: {
    anchor: [regionIndex: number, offset: number];
    focus: [regionIndex: number, offset: number];
  };
}) {
  const reconciliation = reconcileExternalContentChange(previousState, createState(nextMarkdown));

  expect(reconciliation.didReconcile).toBe(true);
  expectRegions(reconciliation.state, regions);
  expectSelection(reconciliation.state.selection, reconciliation.state, selection);
}

function expectSelection(
  selection: EditorSelection | null,
  state: EditorState,
  expected: {
    anchor: [regionIndex: number, offset: number];
    focus: [regionIndex: number, offset: number];
  },
) {
  expect(selection).toEqual({
    anchor: resolveExpectedPoint(state, expected.anchor),
    focus: resolveExpectedPoint(state, expected.focus),
  });
}

function resolveExpectedPoint(state: EditorState, point: [regionIndex: number, offset: number]) {
  const [regionIndex, offset] = point;
  const region = state.documentIndex.regions[regionIndex];

  if (!region) {
    throw new Error(`Missing editor region at index ${regionIndex}`);
  }

  return {
    offset,
    regionId: region.id,
  };
}

function selectRegionText(
  markdown: string,
  regionIndex: number,
  startOffset: number,
  endOffset: number,
): EditorState;
function selectRegionText(
  state: EditorState,
  regionIndex: number,
  startOffset: number,
  endOffset: number,
): EditorState;
function selectRegionText(
  input: EditorState | string,
  regionIndex: number,
  startOffset: number,
  endOffset: number,
) {
  const state = typeof input === "string" ? createState(input) : input;
  const region = state.documentIndex.regions[regionIndex];

  if (!region) {
    throw new Error(`Missing editor region at index ${regionIndex}`);
  }

  return setSelection(state, {
    anchor: {
      offset: startOffset,
      regionId: region.id,
    },
    focus: {
      offset: endOffset,
      regionId: region.id,
    },
  });
}

function selectRegionRange(
  markdown: string,
  anchorRegionIndex: number,
  anchorOffset: number,
  focusRegionIndex: number,
  focusOffset: number,
) {
  const state = createState(markdown);
  const anchorRegion = state.documentIndex.regions[anchorRegionIndex];
  const focusRegion = state.documentIndex.regions[focusRegionIndex];

  if (!anchorRegion || !focusRegion) {
    throw new Error("Missing editor region for range selection");
  }

  return setSelection(state, {
    anchor: {
      offset: anchorOffset,
      regionId: anchorRegion.id,
    },
    focus: {
      offset: focusOffset,
      regionId: focusRegion.id,
    },
  });
}
