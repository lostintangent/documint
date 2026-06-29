import { describe, expect, test } from "bun:test";
import {
  reconcileExternalContentChange,
  resolveEquivalentSelection,
  restoreEquivalentSelection,
} from "@/component/sync";
import {
  createEditorState,
  resolveRootPrimaryRegion,
  setSelection,
  type EditorSelection,
  type EditorState,
} from "@/editor/state";
import {
  createBlockquoteBlock,
  createDocument,
  createListBlock,
  createListItemBlock,
  createParagraphTextBlock,
  createTableBlock,
  createTableCell,
  createTableRow,
  spliceDocument,
} from "@/document";
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

  test("preserves a selection in a long document shifted by an inserted root", () => {
    const previousMarkdown = createNumberedParagraphMarkdown(1200);
    const nextMarkdown = `External intro paragraph.\n\n${previousMarkdown}`;
    const previousState = selectRegionText(previousMarkdown, 600, 12, 12);
    const nextState = createState(nextMarkdown);

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [601, 12],
      focus: [601, 12],
    });
  });

  test("preserves a range selection when an external empty paragraph is inserted above it", () => {
    const previousState = selectRegionText("Target paragraph\n", 0, 0, 6);
    const previousDocument = previousState.documentIndex.document;
    const nextDocument = spliceDocument(previousDocument, 0, 1, [
      createParagraphTextBlock(""),
      createParagraphTextBlock("Target paragraph edited"),
    ]);
    const nextState = createEditorState(nextDocument);

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [1, 0],
      focus: [1, 6],
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

  test("uses document node anchors to disambiguate matching region text", () => {
    const previousState = selectRegionText("**Target paragraph**\n", 0, 2, 8);
    const nextState = createState("Intro paragraph\n\nTarget paragraph\n\n**Target paragraph**\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [2, 2],
      focus: [2, 8],
    });
  });

  test("prefers node-anchor matches over same-path duplicate text", () => {
    const previousState = selectRegionText(
      "Target paragraph\n\nAfter paragraph\n\nOther paragraph\n\nTarget paragraph\n",
      0,
      6,
      6,
    );
    const nextState = createState(
      "Target paragraph\n\nOther paragraph\n\nTarget paragraph\n\nAfter paragraph\n",
    );

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [2, 6],
      focus: [2, 6],
    });
  });

  test("prefers a moved exact node over a same-path context match", () => {
    const previousState = selectRegionText(
      "Before context\n\nAlpha target omega\n\nAfter context\n",
      1,
      12,
      12,
    );
    const nextState = createState(
      "Before context\n\nAlpha inserted target omega\n\nAlpha target omega\n\nAfter context\n",
    );

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [2, 12],
      focus: [2, 12],
    });
  });

  test("does not use same-path context when competing exact content is ambiguous", () => {
    const previousState = selectRegionText(
      "Before context\n\nAlpha target omega\n\nAfter context\n",
      1,
      12,
      12,
    );
    const nextState = createState(
      "Before context\n\nAlpha inserted target omega\n\nAlpha target omega\n\nOther paragraph\n\nAlpha target omega\n\nDifferent paragraph\n",
    );

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("uses unique projected editor text when formatting changes make the node anchor absent", () => {
    const previousState = selectRegionText("Target paragraph\n", 0, 6, 6);
    const nextState = createState("Intro paragraph\n\n**Target paragraph**\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [1, 6],
      focus: [1, 6],
    });
  });

  test("preserves same-path edits when the old offset has a strong text-anchor match", () => {
    const previousState = selectRegionText("Target paragraph\n", 0, 6, 6);
    const nextState = createState("Target paragraph extended\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 6],
      focus: [0, 6],
    });
  });

  test("preserves a path-based selection when the same path has unchanged content", () => {
    const previousState = selectRegionText("Target paragraph\n", 0, 6, 6);
    const nextState = createState("Target paragraph\n\nEdited elsewhere\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 6],
      focus: [0, 6],
    });
  });

  test("preserves a path-based selection when the same path has a text-anchor match", () => {
    const previousState = selectRegionText("Alpha target omega\n", 0, 12, 12);
    const nextState = createState("Alpha inserted target omega\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 21],
      focus: [0, 21],
    });
  });

  test("does not repair a path-based selection when same-path content is unrelated", () => {
    const previousState = selectRegionText("Target paragraph\n", 0, 6, 6);
    const nextState = createState("Unrelated replacement\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("does not repair a same-path selection from weak prefix overlap alone", () => {
    const previousState = selectRegionText("Paragraph target\n", 0, "Paragraph ".length, 10);
    const nextState = createState("Paragraph changed\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("does not repair a same-path selection from weak suffix overlap alone", () => {
    const previousState = selectRegionText("Target paragraph\n", 0, 7, 7);
    const nextState = createState("Changed paragraph\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("does not jump to a unique projected-text decoy when the node anchor is ambiguous", () => {
    const previousState = selectRegionText("Target paragraph\n\nOther paragraph\n", 0, 6, 6);
    const nextState = createState("Completely different\n\nTarget paragraph\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("does not repair a path-based range when one endpoint lacks an anchor/content match", () => {
    const previousState = selectRegionRange("Alpha stable\n\nTarget paragraph\n", 0, 5, 1, 6);
    const nextState = createState("Alpha stable\n\nUnrelated replacement\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("does not repair a path-based table cell when same-path content is unrelated", () => {
    const previousState = selectRegionByText(
      "| A | B |\n| - | - |\n| Target cell | Stable |\n",
      "Target cell",
      6,
      6,
    );
    const nextState = createState("| A | B |\n| - | - |\n| Unrelated | Stable |\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("does not repair through inserted-empty-root fallback when shifted content is unrelated", () => {
    const previousState = selectRegionText("Target paragraph\n", 0, 6, 6);
    const previousDocument = previousState.documentIndex.document;
    const nextDocument = spliceDocument(previousDocument, 0, 1, [
      createParagraphTextBlock(""),
      createParagraphTextBlock("Unrelated replacement"),
    ]);
    const nextState = createEditorState(nextDocument);

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("repairs through inserted-empty-root fallback when shifted content keeps anchor context", () => {
    const previousState = selectRegionText("Alpha target omega\n", 0, 12, 12);
    const previousDocument = previousState.documentIndex.document;
    const nextDocument = spliceDocument(previousDocument, 0, 1, [
      createParagraphTextBlock(""),
      createParagraphTextBlock("Alpha inserted target omega"),
    ]);
    const nextState = createEditorState(nextDocument);

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [1, 21],
      focus: [1, 21],
    });
  });

  test("does not repair non-empty selections by stale path across structural shifts", () => {
    const previousState = selectRegionText("Target paragraph\n", 0, 6, 6);
    const nextState = createState("Intro paragraph\n\nTarget paragraph extended\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("returns null when the previous selection path is stale", () => {
    const previousState = withSelection(createState("Target paragraph\n"), {
      anchor: { offset: 0, regionPath: "root.404.children" },
      focus: { offset: 0, regionPath: "root.404.children" },
    });
    const nextState = createState("Target paragraph\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("returns null when one range endpoint is stale", () => {
    const previousState = createState("Target paragraph\n");
    const region = previousState.documentIndex.regions[0]!;
    const staleEndpoint = { offset: 0, regionPath: "root.404.children" };
    const nextState = createState("Target paragraph edited\n");

    expect(
      resolveEquivalentSelection(
        withSelection(previousState, {
          anchor: { offset: 6, regionPath: region.path },
          focus: staleEndpoint,
        }),
        nextState,
      ),
    ).toBeNull();
  });
});

describe("selection anchor reconciliation", () => {
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

  test("preserves reverse range affinity", () => {
    const state = createState("Alpha target omega\n");
    const region = state.documentIndex.regions[0]!;
    const previousState = withSelection(state, {
      anchor: { offset: 12, regionPath: region.path },
      focus: { offset: 6, regionPath: region.path },
    });
    const nextState = createState("Alpha inserted target omega\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 21],
      focus: [0, 15],
    });
  });
});

describe("state restoration", () => {
  test("restores selection without mutating editor state shape", () => {
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
    expect(restoredState).not.toHaveProperty("animations");
  });
});

describe("external content reconciliation", () => {
  test("reports no reconciliation when a same-path replacement is unrelated", () => {
    const previousState = selectRegionText("Target paragraph\n", 0, 6, 6);
    const reconciliation = reconcileExternalContentChange(
      previousState,
      createState("Unrelated replacement\n"),
    );

    expect(reconciliation.didReconcile).toBe(false);
    expectRegions(reconciliation.state, ["Unrelated replacement"]);
  });

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

  test("does not recreate a transient empty paragraph for a range selection", () => {
    const previousState = insertTransientEmptyRootParagraph("Alpha paragraph\n", 0);
    const alphaRegion = previousState.documentIndex.regions[1]!;
    const rangeState = withSelection(previousState, {
      anchor: previousState.selection.anchor,
      focus: { offset: 5, regionPath: alphaRegion.path },
    });
    const reconciliation = reconcileExternalContentChange(rangeState, createState("Alpha paragraph\n"));

    expect(reconciliation.didReconcile).toBe(false);
    expectRegions(reconciliation.state, ["Alpha paragraph"]);
  });

  test("does not recreate nested empty paragraphs", () => {
    const previousState = selectRegionText(
      createEditorState(
        createDocument([
          createBlockquoteBlock([createParagraphTextBlock("")]),
          createParagraphTextBlock("Alpha paragraph"),
        ]),
      ),
      0,
      0,
      0,
    );
    const reconciliation = reconcileExternalContentChange(
      previousState,
      createState("Alpha paragraph\n"),
    );

    expect(reconciliation.didReconcile).toBe(false);
    expectRegions(reconciliation.state, ["Alpha paragraph"]);
  });

  test("does not recreate empty list item paragraphs", () => {
    const previousState = selectRegionText(
      createEditorState(
        createDocument([
          createListBlock({
            compact: true,
            items: [
              createListItemBlock({
                checked: null,
                children: [createParagraphTextBlock("")],
                compact: true,
              }),
            ],
            ordered: false,
            start: null,
          }),
          createParagraphTextBlock("Alpha paragraph"),
        ]),
      ),
      0,
      0,
      0,
    );
    const reconciliation = reconcileExternalContentChange(
      previousState,
      createState("Alpha paragraph\n"),
    );

    expect(reconciliation.didReconcile).toBe(false);
    expectRegions(reconciliation.state, ["Alpha paragraph"]);
  });

  test("does not recreate empty table cells", () => {
    const previousState = selectRegionText(
      createEditorState(
        createDocument([
          createTableBlock({
            rows: [createTableRow([createTableCell([])])],
          }),
          createParagraphTextBlock("Alpha paragraph"),
        ]),
      ),
      0,
      0,
      0,
    );
    const reconciliation = reconcileExternalContentChange(
      previousState,
      createState("Alpha paragraph\n"),
    );

    expect(reconciliation.didReconcile).toBe(false);
    expectRegions(reconciliation.state, ["Alpha paragraph"]);
  });

  test("does not recreate a transient empty paragraph without surviving neighbors", () => {
    const previousState = selectRegionText(
      createEditorState(createDocument([createParagraphTextBlock("")])),
      0,
      0,
      0,
    );
    const reconciliation = reconcileExternalContentChange(previousState, createState(""));

    expect(reconciliation.didReconcile).toBe(false);
    expectRegions(reconciliation.state, [""]);
  });

  test("does not recreate a transient empty paragraph with ambiguous duplicate neighbors", () => {
    const previousState = insertTransientEmptyRootParagraph(
      "Alpha paragraph\n\nBeta paragraph\n",
      1,
    );
    const reconciliation = reconcileExternalContentChange(
      previousState,
      createState(
        "Intro paragraph\n\nAlpha paragraph\n\nAlpha paragraph\n\nBeta paragraph\n\nBeta paragraph\n",
      ),
    );

    expect(reconciliation.didReconcile).toBe(false);
    expectRegions(reconciliation.state, [
      "Intro paragraph",
      "Alpha paragraph",
      "Alpha paragraph",
      "Beta paragraph",
      "Beta paragraph",
    ]);
  });

  test("does not recreate a transient empty paragraph when neighbors reverse order", () => {
    const previousState = insertTransientEmptyRootParagraph(
      "Alpha paragraph\n\nBeta paragraph\n",
      1,
    );
    const reconciliation = reconcileExternalContentChange(
      previousState,
      createState("Beta paragraph\n\nAlpha paragraph\n"),
    );

    expect(reconciliation.didReconcile).toBe(false);
    expectRegions(reconciliation.state, ["Beta paragraph", "Alpha paragraph"]);
  });
});

function createState(markdown: string) {
  return createEditorState(parseDocument(markdown));
}

function createNumberedParagraphMarkdown(count: number) {
  return Array.from(
    { length: count },
    (_, index) =>
      `Paragraph ${String(index + 1).padStart(4, "0")} carries unique reconciliation text.`,
  ).join("\n\n");
}

function withSelection(state: EditorState, selection: EditorSelection): EditorState {
  return {
    ...state,
    selection,
  };
}

function insertTransientEmptyRootParagraph(markdown: string, rootIndex: number) {
  const state = createState(markdown);
  const nextDocument = spliceDocument(state.documentIndex.document, rootIndex, 0, [
    createParagraphTextBlock(""),
  ]);
  const nextState = createEditorState(nextDocument);
  const region = resolveRootPrimaryRegion(nextState.documentIndex, rootIndex);
  const selection = region
    ? {
        anchor: { regionPath: region.path, offset: 0 },
        focus: { regionPath: region.path, offset: 0 },
      }
    : null;

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
    regionPath: region.path,
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
      regionPath: region.path,
    },
    focus: {
      offset: endOffset,
      regionPath: region.path,
    },
  });
}

function selectRegionRange(
  markdown: string,
  anchorRegionIndex: number,
  selectionAnchorOffset: number,
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
      offset: selectionAnchorOffset,
      regionPath: anchorRegion.path,
    },
    focus: {
      offset: focusOffset,
      regionPath: focusRegion.path,
    },
  });
}

function selectRegionByText(
  markdown: string,
  text: string,
  startOffset: number,
  endOffset: number,
) {
  const state = createState(markdown);
  const region = state.documentIndex.regions.find((candidate) => candidate.text === text);

  if (!region) {
    throw new Error(`Missing editor region with text: ${text}`);
  }

  return setSelection(state, {
    anchor: {
      offset: startOffset,
      regionPath: region.path,
    },
    focus: {
      offset: endOffset,
      regionPath: region.path,
    },
  });
}
