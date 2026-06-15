import { describe, expect, test } from "bun:test";
import {
  createDocument,
  createParagraphTextBlock,
  createTableBlock,
  createTableCell,
  createTableRow,
  createText,
} from "@/document";
import { createEditorState } from "@/editor";
import {
  remapDecorationIndexForTextEdit,
  remapDecorationRangesForTextEdit,
  reconcileDecorationRootResults,
  resolveDecorationRootSourceKey,
} from "@/component/decorations/client/reconciliation";

describe("decoration root result reconciliation", () => {
  test("maps matching root results to current editor regions and suppresses duplicates", () => {
    const document = createDocument([createParagraphTextBlock("A list item")]);
    const state = createEditorState(document);
    const documentIndex = state.documentIndex;
    const sourceBlock = document.blocks[0]!;
    const result = {
      ranges: [
        {
          color: "red",
          backgroundColor: "gold",
          pulse: true,
          endOffset: 6,
          path: "root.0.children",
          startOffset: 2,
        },
      ],
      rootIndex: 0,
      sourceKey: resolveDecorationRootSourceKey(sourceBlock),
    };

    const next = reconcileDecorationRootResults(state, new Map(), [result]);

    expect(next).not.toBeNull();
    expect([...next!.values()]).toEqual([
      [
        {
          backgroundColor: "gold",
          pulse: true,
          color: "red",
          endOffset: 6,
          path: documentIndex.regions[0]!.path,
          startOffset: 2,
        },
      ],
    ]);
    expect(reconcileDecorationRootResults(state, next!, [result])).toBeNull();
  });

  test("drops stale decoration results when the root source changed", () => {
    const document = createDocument([createParagraphTextBlock("A list item")]);
    const changedDocument = createDocument([createParagraphTextBlock("A different item")]);
    const changedState = createEditorState(changedDocument);
    const previous = new Map([
      ["root.0.children", [{ color: "blue", endOffset: 4, path: "root.0.children", startOffset: 0 }]],
    ]);
    const result = {
      ranges: [
        {
          color: "red",
          endOffset: 6,
          path: "root.0.children",
          startOffset: 2,
        },
      ],
      rootIndex: 0,
      sourceKey: resolveDecorationRootSourceKey(document.blocks[0]!),
    };

    expect(reconcileDecorationRootResults(changedState, previous, [result])).toBeNull();
  });

  test("maps table cell range paths to table cell decoration entries", () => {
    const document = createDocument([
      createTableBlock({
        align: [null],
        rows: [createTableRow([createTableCell([createText("Cell target")])])],
      }),
    ]);
    const state = createEditorState(document);
    const sourceBlock = document.blocks[0]!;
    const result = {
      ranges: [
        {
          color: "purple",
          endOffset: 11,
          path: "root.0.rows.0.cells.0",
          startOffset: 5,
        },
      ],
      rootIndex: 0,
      sourceKey: resolveDecorationRootSourceKey(sourceBlock),
    };

    const next = reconcileDecorationRootResults(state, new Map(), [result]);

    expect(next).toEqual(
      new Map([
        [
          "root.0.rows.0.cells.0",
          [
            {
              color: "purple",
              endOffset: 11,
              path: "root.0.rows.0.cells.0",
              startOffset: 5,
            },
          ],
        ],
      ]),
    );
  });
});

describe("decoration text edit remapping", () => {
  test("shifts ranges after an insertion and drops the edited range", () => {
    const ranges = [
      { color: "gray", endOffset: 2, path: "root.0.source", startOffset: 0 },
      { color: "blue", endOffset: 7, path: "root.0.source", startOffset: 3 },
      { color: "green", endOffset: 12, path: "root.0.source", startOffset: 9 },
    ];

    expect(
      remapDecorationRangesForTextEdit(ranges, {
        deletedLength: 0,
        insertedLength: 2,
        startOffset: 5,
      }),
    ).toEqual([
      ranges[0],
      { color: "green", endOffset: 14, path: "root.0.source", startOffset: 11 },
    ]);
  });

  test("shifts ranges after a deletion and preserves surviving range fragments", () => {
    const ranges = [
      { color: "gray", endOffset: 2, path: "root.0.source", startOffset: 0 },
      { color: "blue", endOffset: 8, path: "root.0.source", startOffset: 4 },
      { color: "green", endOffset: 14, path: "root.0.source", startOffset: 10 },
    ];

    expect(
      remapDecorationRangesForTextEdit(ranges, {
        deletedLength: 3,
        insertedLength: 0,
        startOffset: 5,
      }),
    ).toEqual([
      ranges[0],
      { color: "blue", endOffset: 5, path: "root.0.source", startOffset: 4 },
      { color: "green", endOffset: 11, path: "root.0.source", startOffset: 7 },
    ]);
  });

  test("remaps decoration fragments that span both sides of a deletion", () => {
    const ranges = [
      { color: "string", endOffset: 12, path: "root.0.source", startOffset: 3 },
      { color: "comment", endOffset: 10, path: "root.0.source", startOffset: 6 },
      { color: "keyword", endOffset: 8, path: "root.0.source", startOffset: 5 },
    ];

    expect(
      remapDecorationRangesForTextEdit(ranges, {
        deletedLength: 3,
        insertedLength: 0,
        startOffset: 5,
      }),
    ).toEqual([
      { color: "string", endOffset: 9, path: "root.0.source", startOffset: 3 },
      { color: "comment", endOffset: 7, path: "root.0.source", startOffset: 5 },
    ]);
  });

  test("patches only the edited region path in the decoration index", () => {
    const previous = new Map([
      [
        "root.0.children",
        [{ color: "blue", endOffset: 6, path: "root.0.children", startOffset: 3 }],
      ],
      ["root.1.source", [{ color: "red", endOffset: 4, path: "root.1.source", startOffset: 0 }]],
    ]);

    const next = remapDecorationIndexForTextEdit(previous, {
      deletedLength: 0,
      insertedLength: 2,
      regionPath: "root.0.children",
      startOffset: 0,
    });

    expect(next).toEqual(
      new Map([
        [
          "root.0.children",
          [{ color: "blue", endOffset: 8, path: "root.0.children", startOffset: 5 }],
        ],
        ["root.1.source", [{ color: "red", endOffset: 4, path: "root.1.source", startOffset: 0 }]],
      ]),
    );
  });

  test("does not color inserted source text before the worker resolves it", () => {
    const ranges = [
      { color: "keyword", endOffset: 5, path: "root.0.source", startOffset: 0 },
      { color: "string", endOffset: 12, path: "root.0.source", startOffset: 8 },
    ];

    expect(
      remapDecorationRangesForTextEdit(ranges, {
        deletedLength: 0,
        insertedLength: 3,
        startOffset: 5,
      }),
    ).toEqual([
      { color: "keyword", endOffset: 5, path: "root.0.source", startOffset: 0 },
      { color: "string", endOffset: 15, path: "root.0.source", startOffset: 11 },
    ]);
  });
});
