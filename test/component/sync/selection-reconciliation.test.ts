import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import {
  reconcileExternalContentChange,
  resolveEquivalentSelection,
  restoreEquivalentSelection,
} from "@/component/sync";
import {
  createEditorState,
  resolveBlockTextPathBoundary,
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
  rootBlockPath,
  spliceDocument,
} from "@/document";
import { parseDocument } from "@/markdown";

describe("selection reconciliation", () => {
  test("preserves a collapsed cursor when the equivalent path survives", () => {
    const previousState = selectPathText(
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
    const previousState = selectPathText("Alpha paragraph\n\nTarget paragraph\n", 1, 2, 8);
    const nextState = createState("Alpha paragraph\n\nTarget paragraph extended\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [1, 2],
      focus: [1, 8],
    });
  });

  test("preserves a selection across paths during unrelated external edits", () => {
    const previousState = selectPathRange(
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
    const previousState = selectPathText(previousMarkdown, 600, 12, 12);
    const nextState = createState(nextMarkdown);

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [601, 12],
      focus: [601, 12],
    });
  });

  test("preserves a range selection when an external empty paragraph is inserted above it", () => {
    const previousState = selectPathText("Target paragraph\n", 0, 0, 6);
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

  test("clamps the restored cursor when a matched path becomes shorter", () => {
    const previousState = selectPathText("Alpha paragraph\n", 0, 12, 12);
    const nextState = createState("Alpha\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 5],
      focus: [0, 5],
    });
  });

  test("returns null when the selected path cannot be matched", () => {
    const previousState = selectPathText("Alpha paragraph\n\nTarget paragraph\n", 1, 4, 4);
    const nextState = createState("Alpha paragraph\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("does not guess when text matching is ambiguous", () => {
    const previousState = selectPathText(
      "Alpha paragraph\n\nBeta paragraph\n\nTarget paragraph\n",
      2,
      4,
      4,
    );
    const nextState = createState("Target paragraph\n\nTarget paragraph\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("uses document node anchors to disambiguate matching path text", () => {
    const previousState = selectPathText("**Target paragraph**\n", 0, 2, 8);
    const nextState = createState("Intro paragraph\n\nTarget paragraph\n\n**Target paragraph**\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [2, 2],
      focus: [2, 8],
    });
  });

  test("prefers node-anchor matches over same-path duplicate text", () => {
    const previousState = selectPathText(
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
    const previousState = selectPathText(
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
    const previousState = selectPathText(
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
    const previousState = selectPathText("Target paragraph\n", 0, 6, 6);
    const nextState = createState("Intro paragraph\n\n**Target paragraph**\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [1, 6],
      focus: [1, 6],
    });
  });

  test("preserves same-path edits when the old offset has a strong text-anchor match", () => {
    const previousState = selectPathText("Target paragraph\n", 0, 6, 6);
    const nextState = createState("Target paragraph extended\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 6],
      focus: [0, 6],
    });
  });

  test("preserves a path-based selection when the same path has unchanged content", () => {
    const previousState = selectPathText("Target paragraph\n", 0, 6, 6);
    const nextState = createState("Target paragraph\n\nEdited elsewhere\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 6],
      focus: [0, 6],
    });
  });

  test("preserves a path-based selection when the same path has a text-anchor match", () => {
    const previousState = selectPathText("Alpha target omega\n", 0, 12, 12);
    const nextState = createState("Alpha inserted target omega\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 21],
      focus: [0, 21],
    });
  });

  test("does not repair a path-based selection when same-path content is unrelated", () => {
    const previousState = selectPathText("Target paragraph\n", 0, 6, 6);
    const nextState = createState("Unrelated replacement\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("does not repair a same-path selection from weak prefix overlap alone", () => {
    const previousState = selectPathText("Paragraph target\n", 0, "Paragraph ".length, 10);
    const nextState = createState("Paragraph changed\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("does not repair a same-path selection from weak suffix overlap alone", () => {
    const previousState = selectPathText("Target paragraph\n", 0, 7, 7);
    const nextState = createState("Changed paragraph\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("does not jump to a unique projected-text decoy when the node anchor is ambiguous", () => {
    const previousState = selectPathText("Target paragraph\n\nOther paragraph\n", 0, 6, 6);
    const nextState = createState("Completely different\n\nTarget paragraph\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("does not repair a path-based range when one endpoint lacks an anchor/content match", () => {
    const previousState = selectPathRange("Alpha stable\n\nTarget paragraph\n", 0, 5, 1, 6);
    const nextState = createState("Alpha stable\n\nUnrelated replacement\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("does not repair a path-based table cell when same-path content is unrelated", () => {
    const previousState = selectPathByText(
      "| A | B |\n| - | - |\n| Target cell | Stable |\n",
      "Target cell",
      6,
      6,
    );
    const nextState = createState("| A | B |\n| - | - |\n| Unrelated | Stable |\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("preserves a caret in a still-empty list item path", () => {
    const previousState = selectPathByText("- \n\nOther\n", "", 0, 0);
    const nextState = createState("- \n\nOther edited\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toEqual(previousState.selection);
  });

  test("preserves a caret in a still-empty table cell path", () => {
    const previousState = selectPathByText("| A | B |\n| - | - |\n| | Stable |\n", "", 0, 0);
    const nextState = createState("| A | B |\n| - | - |\n| | Stable edited |\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toEqual(previousState.selection);
  });

  test("preserves a caret in a still-empty code path", () => {
    const previousState = selectPathByText("```ts\n\n```\n\nOther\n", "", 0, 0);
    const nextState = createState("```ts\n\n```\n\nOther edited\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toEqual(previousState.selection);
  });

  test("does not repair through inserted-empty-root fallback when shifted content is unrelated", () => {
    const previousState = selectPathText("Target paragraph\n", 0, 6, 6);
    const previousDocument = previousState.documentIndex.document;
    const nextDocument = spliceDocument(previousDocument, 0, 1, [
      createParagraphTextBlock(""),
      createParagraphTextBlock("Unrelated replacement"),
    ]);
    const nextState = createEditorState(nextDocument);

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("repairs through inserted-empty-root fallback when shifted content keeps anchor context", () => {
    const previousState = selectPathText("Alpha target omega\n", 0, 12, 12);
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
    const previousState = selectPathText("Target paragraph\n", 0, 6, 6);
    const nextState = createState("Intro paragraph\n\nTarget paragraph extended\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("returns null when the previous selection path is stale", () => {
    const previousState = withSelection(createState("Target paragraph\n"), {
      anchor: { offset: 0, path: "root.404.children" },
      focus: { offset: 0, path: "root.404.children" },
    });
    const nextState = createState("Target paragraph\n");

    expect(resolveEquivalentSelection(previousState, nextState)).toBeNull();
  });

  test("returns null when one range endpoint is stale", () => {
    const previousState = createState("Target paragraph\n");
    const path = indexedTextEntries(previousState)[0]!;
    const staleEndpoint = { offset: 0, path: "root.404.children" };
    const nextState = createState("Target paragraph edited\n");

    expect(
      resolveEquivalentSelection(
        withSelection(previousState, {
          anchor: { offset: 6, path: path.path },
          focus: staleEndpoint,
        }),
        nextState,
      ),
    ).toBeNull();
  });
});

describe("selection anchor reconciliation", () => {
  test("moves a collapsed cursor forward when text is inserted before it", () => {
    const previousState = selectPathText("Alpha target omega\n", 0, 12, 12);
    const nextState = createState("Alpha inserted target omega\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 21],
      focus: [0, 21],
    });
  });

  test("moves a collapsed cursor backward when text before it is deleted", () => {
    const previousState = selectPathText("Alpha removed target omega\n", 0, 20, 20);
    const nextState = createState("Alpha target omega\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 12],
      focus: [0, 12],
    });
  });

  test("keeps a collapsed cursor stable when only text after it changes", () => {
    const previousState = selectPathText("Alpha target omega\n", 0, 12, 12);
    const nextState = createState("Alpha target revised omega\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 12],
      focus: [0, 12],
    });
  });

  test("moves a range selection when text is inserted before the range", () => {
    const previousState = selectPathText("Alpha target omega\n", 0, 6, 12);
    const nextState = createState("Alpha inserted target omega\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 15],
      focus: [0, 21],
    });
  });

  test("expands a range selection when text is inserted inside the selected text", () => {
    const previousState = selectPathText("The quick brown fox\n", 0, 4, 15);
    const nextState = createState("The quick red brown fox\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 4],
      focus: [0, 19],
    });
  });

  test("shrinks a range selection when text is deleted inside the selected text", () => {
    const previousState = selectPathText("The quick red brown fox\n", 0, 4, 19);
    const nextState = createState("The quick brown fox\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 4],
      focus: [0, 15],
    });
  });

  test("collapses a range selection when the selected text is deleted", () => {
    const previousState = selectPathText("The quick brown fox\n", 0, 4, 15);
    const nextState = createState("The  fox\n");

    expectSelection(resolveEquivalentSelection(previousState, nextState), nextState, {
      anchor: [0, 4],
      focus: [0, 4],
    });
  });

  test("preserves reverse range affinity", () => {
    const state = createState("Alpha target omega\n");
    const path = indexedTextEntries(state)[0]!;
    const previousState = withSelection(state, {
      anchor: { offset: 12, path: path.path },
      focus: { offset: 6, path: path.path },
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
    const previousState = selectPathText(
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
    const previousState = selectPathText("Target paragraph\n", 0, 6, 6);
    const reconciliation = reconcileExternalContentChange(
      previousState,
      createState("Unrelated replacement\n"),
    );

    expect(reconciliation.didReconcile).toBe(false);
    expectTextEntries(reconciliation.state, ["Unrelated replacement"]);
  });

  test("recreates a missing empty paragraph before a reconciled following block", () => {
    expectTransientEmptyParagraphReconciliation({
      nextMarkdown: "Alpha paragraph\n",
      previousMarkdown: "Alpha paragraph\n",
      paths: ["", "Alpha paragraph"],
      selectionPathIndex: 0,
      transientRootIndex: 0,
    });
  });

  test("recreates a missing final empty paragraph and keeps the cursor inside it", () => {
    expectTransientEmptyParagraphReconciliation({
      nextMarkdown: "Alpha paragraph edited\n",
      previousMarkdown: "Alpha paragraph\n",
      paths: ["Alpha paragraph edited", ""],
      selectionPathIndex: 1,
      transientRootIndex: 1,
    });
  });

  test("recreates a missing empty paragraph between reconciled neighboring blocks", () => {
    expectTransientEmptyParagraphReconciliation({
      nextMarkdown: "Alpha paragraph edited\n\nBeta paragraph\n",
      previousMarkdown: "Alpha paragraph\n\nBeta paragraph\n",
      paths: ["Alpha paragraph edited", "", "Beta paragraph"],
      selectionPathIndex: 1,
      transientRootIndex: 1,
    });
  });

  test("recreates a missing empty paragraph after a reconciled task list root", () => {
    expectTransientEmptyParagraphReconciliation({
      nextMarkdown: "Alpha paragraph edited\n\n- [ ] task one\n- [x] task two\n",
      previousMarkdown: "Alpha paragraph\n\n- [ ] task one\n- [x] task two\n",
      paths: ["Alpha paragraph edited", "task one", "task two", ""],
      selectionPathIndex: 3,
      transientRootIndex: 2,
    });
  });

  test("does not recreate a transient empty paragraph for a range selection", () => {
    const previousState = insertTransientEmptyRootParagraph("Alpha paragraph\n", 0);
    const alphaEntry = indexedTextEntries(previousState)[1]!;
    const rangeState = withSelection(previousState, {
      anchor: previousState.selection.anchor,
      focus: { offset: 5, path: alphaEntry.path },
    });
    const reconciliation = reconcileExternalContentChange(
      rangeState,
      createState("Alpha paragraph\n"),
    );

    expect(reconciliation.didReconcile).toBe(false);
    expectTextEntries(reconciliation.state, ["Alpha paragraph"]);
  });

  test("does not recreate nested empty paragraphs", () => {
    const previousState = selectPathText(
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
    expectTextEntries(reconciliation.state, ["Alpha paragraph"]);
  });

  test("does not recreate empty list item paragraphs", () => {
    const previousState = selectPathText(
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
    expectTextEntries(reconciliation.state, ["Alpha paragraph"]);
  });

  test("does not recreate empty table cells", () => {
    const previousState = selectPathText(
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
    expectTextEntries(reconciliation.state, ["Alpha paragraph"]);
  });

  test("does not recreate a transient empty paragraph without surviving neighbors", () => {
    const previousState = selectPathText(
      createEditorState(createDocument([createParagraphTextBlock("")])),
      0,
      0,
      0,
    );
    const reconciliation = reconcileExternalContentChange(previousState, createState(""));

    expect(reconciliation.didReconcile).toBe(false);
    expectTextEntries(reconciliation.state, [""]);
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
    expectTextEntries(reconciliation.state, [
      "Intro paragraph",
      "Alpha paragraph",
      "Alpha paragraph",
      "Beta paragraph",
      "Beta paragraph",
    ]);
  });

  test("does not recreate a transient empty paragraph when shifted neighbor matches multiple paths in one root", () => {
    const initialState = createEditorState(
      createDocument([
        createParagraphTextBlock("Alpha paragraph"),
        createBlockquoteBlock([createParagraphTextBlock("Beta paragraph")]),
      ]),
    );
    const previousState = selectPathText(
      createEditorState(
        spliceDocument(initialState.documentIndex.document, 1, 0, [createParagraphTextBlock("")]),
      ),
      1,
      0,
      0,
    );
    const reconciliation = reconcileExternalContentChange(
      previousState,
      createEditorState(
        createDocument([
          createParagraphTextBlock("Alpha paragraph"),
          createBlockquoteBlock([
            createParagraphTextBlock("Beta paragraph"),
            createParagraphTextBlock("Beta paragraph"),
          ]),
        ]),
      ),
    );

    expect(reconciliation.didReconcile).toBe(false);
    expectTextEntries(reconciliation.state, [
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
    expectTextEntries(reconciliation.state, ["Beta paragraph", "Alpha paragraph"]);
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
  const point = resolveBlockTextPathBoundary(
    nextState.documentIndex,
    rootBlockPath(rootIndex),
    "start",
  );
  const selection = point
    ? {
        anchor: { path: point, offset: 0 },
        focus: { path: point, offset: 0 },
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
  paths,
  selectionPathIndex,
  transientRootIndex,
}: {
  nextMarkdown: string;
  previousMarkdown: string;
  paths: string[];
  selectionPathIndex: number;
  transientRootIndex: number;
}) {
  expectExternalReconciliation({
    nextMarkdown,
    previousState: insertTransientEmptyRootParagraph(previousMarkdown, transientRootIndex),
    paths,
    selection: {
      anchor: [selectionPathIndex, 0],
      focus: [selectionPathIndex, 0],
    },
  });
}

function expectTextEntries(state: EditorState, expectedText: string[]) {
  expect(indexedTextEntries(state).map((path) => path.text)).toEqual(expectedText);
}

function expectExternalReconciliation({
  nextMarkdown,
  previousState,
  paths,
  selection,
}: {
  nextMarkdown: string;
  previousState: EditorState;
  paths: string[];
  selection: {
    anchor: [pathIndex: number, offset: number];
    focus: [pathIndex: number, offset: number];
  };
}) {
  const reconciliation = reconcileExternalContentChange(previousState, createState(nextMarkdown));

  expect(reconciliation.didReconcile).toBe(true);
  expectTextEntries(reconciliation.state, paths);
  expectSelection(reconciliation.state.selection, reconciliation.state, selection);
}

function expectSelection(
  selection: EditorSelection | null,
  state: EditorState,
  expected: {
    anchor: [pathIndex: number, offset: number];
    focus: [pathIndex: number, offset: number];
  },
) {
  expect(selection).toEqual({
    anchor: resolveExpectedPoint(state, expected.anchor),
    focus: resolveExpectedPoint(state, expected.focus),
  });
}

function resolveExpectedPoint(state: EditorState, point: [pathIndex: number, offset: number]) {
  const [pathIndex, offset] = point;
  const path = indexedTextEntries(state)[pathIndex];

  if (!path) {
    throw new Error(`Missing editor path at index ${pathIndex}`);
  }

  return {
    offset,
    path: path.path,
  };
}

function selectPathText(
  markdown: string,
  pathIndex: number,
  startOffset: number,
  endOffset: number,
): EditorState;
function selectPathText(
  state: EditorState,
  pathIndex: number,
  startOffset: number,
  endOffset: number,
): EditorState;
function selectPathText(
  input: EditorState | string,
  pathIndex: number,
  startOffset: number,
  endOffset: number,
) {
  const state = typeof input === "string" ? createState(input) : input;
  const path = indexedTextEntries(state)[pathIndex];

  if (!path) {
    throw new Error(`Missing editor path at index ${pathIndex}`);
  }

  return setSelection(state, {
    anchor: {
      offset: startOffset,
      path: path.path,
    },
    focus: {
      offset: endOffset,
      path: path.path,
    },
  });
}

function selectPathRange(
  markdown: string,
  anchorPathIndex: number,
  selectionAnchorOffset: number,
  focusPathIndex: number,
  focusOffset: number,
) {
  const state = createState(markdown);
  const anchorPath = indexedTextEntries(state)[anchorPathIndex];
  const focusPath = indexedTextEntries(state)[focusPathIndex];

  if (!anchorPath || !focusPath) {
    throw new Error("Missing editor path for range selection");
  }

  return setSelection(state, {
    anchor: {
      offset: selectionAnchorOffset,
      path: anchorPath.path,
    },
    focus: {
      offset: focusOffset,
      path: focusPath.path,
    },
  });
}

function selectPathByText(markdown: string, text: string, startOffset: number, endOffset: number) {
  const state = createState(markdown);
  const path = indexedTextEntries(state).find((candidate) => candidate.text === text);

  if (!path) {
    throw new Error(`Missing editor path with text: ${text}`);
  }

  return setSelection(state, {
    anchor: {
      offset: startOffset,
      path: path.path,
    },
    focus: {
      offset: endOffset,
      path: path.path,
    },
  });
}
