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
  reconcileDecorationRootResults,
  resolveDecorationRootSourceKey,
} from "@/component/decorations/reconciliation";

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

    expect(reconcileDecorationRootResults(changedState, new Map(), [result])).toBeNull();
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
