import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import {
  blockPathContainsPath,
  createAnchorFromContainer,
  createCommentThread,
  createDividerBlock,
  createMention,
  createParagraphBlock,
  createParagraphTextBlock,
  extractQuoteFromContainer,
  listAnchorContainers,
  spliceDocument,
} from "@/document";
import {
  createDocumentIndex,
  resolveEditorTextAtPath,
  spliceDocumentIndex,
  type DocumentIndex,
  type IndexedBlock,
} from "@/editor/state";
import {
  createIndexedRoot,
  positionIndexedRoots,
} from "@/editor/state/index/roots";
import {
  commitDocument,
  replaceDocumentMetadata,
  replaceEditorBlock,
} from "@/editor/state/index/splice";
import { parseDocument, serializeDocument } from "@/markdown";

describe("Document index build", () => {
  test("builds positioned editor roots directly on the unified model", () => {
    const snapshot = parseDocument(`# Heading

  alpha

beta
`);
    const roots = positionIndexedRoots(
      snapshot.blocks.map((block, rootIndex) => createIndexedRoot(block, rootIndex)),
    );
    const runtime = createDocumentIndex(snapshot);

    expect(roots).toHaveLength(3);
    expect(roots.map((root) => root.blocks[0]?.blockArrayIndex)).toEqual([0, 1, 2]);
    expect(runtime.blocks.map((block) => block.blockArrayIndex)).toEqual([0, 1, 2]);
    expectDocumentIndexMaps(runtime);
  });

  test("rebuilds a root model against a canonical replacement root", () => {
    const snapshot = parseDocument(`# Heading

alpha
`);
    const original = createIndexedRoot(snapshot.blocks[1]!, 1);
    const nextDocument = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("omega")]);
    const rebuilt = createIndexedRoot(nextDocument.blocks[1]!, original.rootIndex);

    expect(rebuilt.rootIndex).toBe(1);
    expect(rebuilt.blocks[0]?.path).toBe("root.1");
    expect(rebuilt.blocks[0]).toMatchObject({ kind: "inlines", text: "omega" });
  });

  test("splices one editor model root while preserving unchanged sibling content", () => {
    const snapshot = parseDocument(`# Heading

alpha

beta
`);
    const model = createDocumentIndex(snapshot);
    const runtime = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("alphabet")]);
    const replacedModel = spliceDocumentIndex(model, nextDocument, 1, 1);
    const replaced = spliceDocumentIndex(runtime, nextDocument, 1, 1);

    expect(replacedModel.document).toBe(nextDocument);
    expect(replacedModel.roots[0]).toBe(model.roots[0]);
    expect(replacedModel.roots[1]).not.toBe(model.roots[1]);
    expect(replacedModel.roots[2]).toBe(model.roots[2]);
    expect(replaced.roots[0]).toBe(runtime.roots[0]);
    expect(replaced.roots[1]).not.toBe(runtime.roots[1]);
    expect(replaced.roots[2]).toBe(runtime.roots[2]);
    expect(resolveEditorTextAtPath(replacedModel, "root.2")).toBe("beta");
    expect(resolveEditorTextAtPath(replaced, "root.2")).toBe("beta");
    expectDocumentIndexMaps(replacedModel);
    expectDocumentIndexMaps(replaced);
  });

  test("preserves suffix roots when only text length changes", () => {
    const snapshot = parseDocument(`alpha

beta

gamma
`);
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(snapshot, 0, 1, [createParagraphTextBlock("alphabet")]);
    const next = spliceDocumentIndex(index, nextDocument, 0, 1);

    expect(next.roots[1]).toBe(index.roots[1]);
    expect(next.roots[1]?.blocks[0]).toBe(index.roots[1]?.blocks[0]);
    expect(next.roots[2]).toBe(index.roots[2]);
    expect(next.roots[2]?.blocks[0]).toBe(index.roots[2]?.blocks[0]);
    expectDocumentIndexMaps(next);
  });

  test("restamps suffix text order when text-host count changes without block-order changes", () => {
    const snapshot = parseDocument(`alpha

---

beta
`);
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("middle")]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 1);

    expect(next.document.blocks[2]).toBe(index.document.blocks[2]);
    expect(next.roots[2]?.blocks[0]?.block).toBe(index.roots[2]?.blocks[0]?.block);
    expect(next.roots[2]?.blocks[0]).toMatchObject({
      editorOrder: 2,
      kind: "inlines",
      text: "beta",
    });
    expect(resolveEditorTextAtPath(next, "root.2")).toBe("beta");
    expectDocumentIndexMaps(next);
  });

  test("restamps suffix table cell order when text-host count changes", () => {
    const snapshot = parseDocument(`alpha

---

| A | B |
| - | - |
| one | two |
`);
    const index = createDocumentIndex(snapshot);
    const previousTable = index.blockIndex.get("root.2");
    const previousCell = index.tableCellIndex.get("root.2.rows.1.cells.1");
    const nextDocument = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("middle")]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 1);
    const nextTable = next.blockIndex.get("root.2");
    const nextCell = next.tableCellIndex.get("root.2.rows.1.cells.1");

    if (!previousTable || !previousCell || !nextTable || !nextCell) {
      throw new Error("Expected suffix table and target cell");
    }

    expect(next.document.blocks[2]).toBe(index.document.blocks[2]);
    expect(nextTable.block).toBe(previousTable.block);
    expect(next.roots[2]).not.toBe(index.roots[2]);
    expect(nextTable).not.toBe(previousTable);
    expect(nextCell).not.toBe(previousCell);
    expect(nextCell).toMatchObject({
      cellIndex: 1,
      path: "root.2.rows.1.cells.1",
      rootIndex: 2,
      rowIndex: 1,
      tablePath: "root.2",
      editorOrder: previousCell.editorOrder + 1,
      text: "two",
    });
    expectDocumentIndexMaps(next);
  });

  test("keeps lookup maps exact when replacing a root with new paths", () => {
    const snapshot = parseDocument(`alpha

beta
`);
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("omega")]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 1);

    expect(next.blocks).toHaveLength(2);
    expect(indexedTextEntries(next)).toHaveLength(2);
    expectDocumentIndexMaps(next);
  });

  test("keeps editor paths stable for in-place content edits", () => {
    const index = createDocumentIndex(parseDocument("alpha\n"));
    const path = indexedTextEntries(index)[0];

    if (!path) {
      throw new Error("Expected editable path");
    }

    const next = replaceEditorBlock(index, path.blockPath, () =>
      createParagraphTextBlock("alphabet"),
    );

    expect(resolveEditorTextAtPath(next!, path.path)).toBe("alphabet");
    expect(next?.blockIndex.get(path.blockPath)?.path).toBe(path.blockPath);
    expectDocumentIndexMaps(next!);
  });

  test("keeps lookup maps exact when inserting a root", () => {
    const snapshot = parseDocument(`alpha

beta
`);
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(snapshot, 1, 0, [createParagraphTextBlock("")]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 0);

    expect(next.blocks.map((indexedBlock) => indexedBlock.block.plainText)).toEqual([
      "alpha",
      "",
      "beta",
    ]);
    expectDocumentIndexMaps(next);
  });

  test("keys block lookup by structural path and stamps parent block paths", () => {
    const index = createDocumentIndex(parseDocument(`> - alpha\n`));
    const list = index.blocks.find((entry) => entry.block.type === "list");
    const item = index.blocks.find((entry) => entry.block.type === "listItem");

    if (!list || !item) {
      throw new Error("Expected nested list blocks");
    }

    expect(index.blockIndex.get(list.path)).toBe(list);
    expect(index.blockIndex.get(item.path)).toBe(item);
    expect(item.parentBlockPath).toBe(list.path);
    expect(index.blockIndex.get(item.parentBlockPath!)).toBe(list);
  });

  test("tracks table block paths separately from cell editor paths", () => {
    const index = createDocumentIndex(parseDocument(`| A |\n| - |\n| B |\n`));
    const table = index.blocks.find((entry) => entry.block.type === "table");
    const cellPath = indexedTextEntries(index).find((entry) => entry.tableCell !== null);

    if (!table || !cellPath) {
      throw new Error("Expected table cell path");
    }
    if (!cellPath.tableCell) {
      throw new Error("Expected table cell path context");
    }

    expect(cellPath.blockPath).toBe(table.path);
    expect(index.blockIndex.get(cellPath.blockPath)).toBe(table);
    expect(index.tableCellIndex.get(cellPath.path)).toBe(cellPath.tableCell);
  });

  test("stamps nested block ranges and table-cell lookups", () => {
    const index = createDocumentIndex(
      parseDocument(`> alpha
>
> - beta

---

| A |
| - |
| B |
`),
    );
    const blockquote = index.blockIndex.get("root.0");
    const list = index.blockIndex.get("root.0.children.1");
    const listItem = index.blockIndex.get("root.0.children.1.children.0");
    const divider = index.blockIndex.get("root.1");
    const table = index.blockIndex.get("root.2");

    if (!blockquote || !list || !listItem || !divider || !table) {
      throw new Error("Expected nested blocks");
    }

    expect(blockquote.blockRangeEnd).toBeGreaterThan(list.blockArrayIndex);
    expect(blockquote.blockRangeEnd).toBeGreaterThan(listItem.blockArrayIndex);
    expect(blockPathContainsPath(blockquote.path, listItem.path)).toBe(true);
    expect(index.tableCellIndex.get("root.2.rows.0.cells.0")).toMatchObject({
      cellIndex: 0,
      rowIndex: 0,
      tablePath: table.path,
    });
    expect(index.tableCellIndex.get("root.2.rows.1.cells.0")).toMatchObject({
      cellIndex: 0,
      rowIndex: 1,
      tablePath: table.path,
    });
    expectDocumentIndexMaps(index);
  });

  test("preserves unchanged flat records on same-length root replacement", () => {
    const snapshot = parseDocument(`alpha

beta

gamma
`);
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("zeta")]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 1);

    expect(next.blocks[0]).toBe(index.blocks[0]);
    expect(next.blocks[1]).not.toBe(index.blocks[1]);
    expect(next.blocks[2]).toBe(index.blocks[2]);
    expect(indexedTextEntries(next).map((entry) => entry.text)).toEqual([
      "alpha",
      "zeta",
      "gamma",
    ]);
    expectDocumentIndexMaps(next);
  });

  test("keeps indexed text paths exact when replacing inert roots", () => {
    const snapshot = parseDocument(`alpha

---

beta
`);
    const index = createDocumentIndex(snapshot);
    const withMiddleText = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("middle")]);
    const insertedText = spliceDocumentIndex(index, withMiddleText, 1, 1);

    expect(indexedTextEntries(insertedText).map((entry) => entry.text)).toEqual([
      "alpha",
      "middle",
      "beta",
    ]);
    expectDocumentIndexMaps(insertedText);

    const withoutMiddleText = spliceDocument(withMiddleText, 1, 1, [createDividerBlock()]);
    const removedText = spliceDocumentIndex(insertedText, withoutMiddleText, 1, 1);

    expect(indexedTextEntries(removedText).map((entry) => entry.text)).toEqual(["alpha", "beta"]);
    expectDocumentIndexMaps(removedText);
  });

  test("collects image URLs per root and unions them at the document level", () => {
    const snapshot = parseDocument(`![one](one.png)

just text

![two](two.png) and ![three](three.png)
`);
    const index = createDocumentIndex(snapshot);

    expect([...index.roots[0]!.imageUrls].sort()).toEqual(["one.png"]);
    expect([...index.roots[1]!.imageUrls]).toEqual([]);
    expect([...index.roots[2]!.imageUrls].sort()).toEqual(["three.png", "two.png"]);
    expect([...index.imageUrls].sort()).toEqual(["one.png", "three.png", "two.png"]);
  });

  test("preserves the document-level imageUrls reference across edits that don't touch images", () => {
    const snapshot = parseDocument(`![pic](pic.png)

alpha
`);
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("alphabet")]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 1);

    // The image-bearing root is reused (sibling edit), so its imageUrls
    // reference is reused. The document-level union value-compares to the
    // previous and reuses the reference too — so a downstream useEffect
    // depending on `documentIndex.imageUrls` does not refire.
    expect(next.roots[0]).toBe(index.roots[0]);
    expect(next.roots[0]!.imageUrls).toBe(index.roots[0]!.imageUrls);
    expect(next.imageUrls).toBe(index.imageUrls);
  });

  test("collects resource URLs per root and preserves the document-level reference across unrelated edits", () => {
    const snapshot = parseDocument(
      `[Recording](demo-resource://recording/live)

just text

[Note](demo-resource://note/complete)
`,
      { resourceProtocols: ["demo-resource:"] },
    );
    const index = createDocumentIndex(snapshot);

    expect([...index.roots[0]!.resourceUrls]).toEqual(["demo-resource://recording/live"]);
    expect([...index.roots[1]!.resourceUrls]).toEqual([]);
    expect([...index.roots[2]!.resourceUrls]).toEqual(["demo-resource://note/complete"]);
    expect([...index.resourceUrls]).toEqual([
      "demo-resource://recording/live",
      "demo-resource://note/complete",
    ]);

    const nextDocument = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("updated")]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 1);

    expect(next.roots[0]).toBe(index.roots[0]);
    expect(next.roots[0]!.resourceUrls).toBe(index.roots[0]!.resourceUrls);
    expect(next.resourceUrls).toBe(index.resourceUrls);
  });

  test("preserves indexed list items across unrelated root edits", () => {
    const snapshot = parseDocument(`1. alpha
2. beta

plain
`);
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("updated")]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 1);

    expect(next.roots[0]?.listItems).toBe(index.roots[0]?.listItems);
    expect(next.listItems).toBe(index.listItems);
    expect([...next.listItems.values()]).toEqual([
      { depth: 0, kind: "ordered", ordinal: 1 },
      { depth: 0, kind: "ordered", ordinal: 2 },
    ]);
    expectDocumentIndexMaps(next);
  });

  test("projects nested unordered list items with contextual semantics", () => {
    const index = createDocumentIndex(
      parseDocument(`- top
  - child
    - grandchild
`),
    );

    expect([...index.listItems.values()]).toEqual([
      { depth: 0, kind: "unordered" },
      { depth: 1, kind: "unordered" },
      { depth: 2, kind: "unordered" },
    ]);
  });

  test("rebuilds the document-level imageUrls when an image is added", () => {
    const snapshot = parseDocument(`alpha

beta
`);
    const index = createDocumentIndex(snapshot);
    const withImage = parseDocument(`alpha

![added](added.png)
`);
    const grown = spliceDocumentIndex(index, withImage, 1, 1);

    expect(grown.imageUrls).not.toBe(index.imageUrls);
    expect([...grown.imageUrls]).toEqual(["added.png"]);
  });

  test("rebuilds the document-level imageUrls when an image is removed", () => {
    const snapshot = parseDocument(`![pic](pic.png)

alpha
`);
    const index = createDocumentIndex(snapshot);
    const withoutImage = parseDocument(`beta

alpha
`);
    const shrunk = spliceDocumentIndex(index, withoutImage, 0, 1);

    expect(shrunk.imageUrls).not.toBe(index.imageUrls);
    expect([...shrunk.imageUrls]).toEqual([]);
  });

  test("replaces a nested editor block through the reducer", () => {
    const documentIndex = createDocumentIndex(parseDocument("- alpha\n"));
    const paragraph = documentIndex.blocks.find(
      (indexedBlock) => indexedBlock.block.type === "paragraph",
    );

    if (!paragraph) {
      throw new Error("Expected paragraph block");
    }

    const reduction = replaceEditorBlock(documentIndex, paragraph.path, () =>
      createParagraphTextBlock("beta"),
    );

    if (!reduction) {
      throw new Error("Expected nested block replacement");
    }

    expect(serializeDocument(commitDocument(reduction))).toBe("- beta\n");
  });

  test("does not delete a block when the replacer rejects it", () => {
    const documentIndex = createDocumentIndex(parseDocument("- alpha\n"));
    const paragraph = documentIndex.blocks.find(
      (indexedBlock) => indexedBlock.block.type === "paragraph",
    );

    if (!paragraph) {
      throw new Error("Expected paragraph block");
    }

    expect(replaceEditorBlock(documentIndex, paragraph.path, () => null)).toBeNull();
    expect(serializeDocument(commitDocument(documentIndex))).toBe("- alpha\n");
    expectDocumentIndexMaps(documentIndex);
  });

  test("reuses index maps and flat arrays on metadata-only document changes", () => {
    const snapshot = parseDocument(`# Heading

alpha

beta
`);
    const index = createDocumentIndex(snapshot);
    // Metadata-only mutation: blocks identical, front matter added.
    const nextDocument = { ...index.document, frontMatter: "title: example\n" };
    const next = replaceDocumentMetadata(index, nextDocument);

    expect(next.document).toBe(nextDocument);
    // Roots, blocks, and lookup maps all keep reference identity —
    // the metadata fast path doesn't allocate any of them.
    expect(next.roots).toBe(index.roots);
    expect(next.blocks).toBe(index.blocks);
    expect(next.blockIndex).toBe(index.blockIndex);
    expect(next.tableCellIndex).toBe(index.tableCellIndex);
    expect(next.imageUrls).toBe(index.imageUrls);
    // listItems reuses when document.blocks identity holds.
    expect(next.listItems).toBe(index.listItems);
    // commentContainerIndex reuses when document.comments identity holds.
    expect(next.commentContainerIndex).toBe(index.commentContainerIndex);
  });

  test("reuses comment container index when editing outside resolved comment roots", () => {
    const snapshot = withCommentAt(
      parseDocument(`commented target

outside text
`),
    );
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(index.document, 1, 1, [
      createParagraphTextBlock("outside text edited"),
    ]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 1);

    expect(next.commentContainerIndex).toBe(index.commentContainerIndex);
    expect([...next.commentContainerIndex.keys()]).toEqual(["root.0"]);
  });

  test("reuses comment container index and suffix roots after unrelated text-length edits", () => {
    const snapshot = withCommentAt(
      parseDocument(`commented target

outside text

suffix mentions target without its prefix
`),
    );
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(index.document, 1, 1, [
      createParagraphTextBlock("outside text edited"),
    ]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 1);

    expect(next.roots[2]).toBe(index.roots[2]);
    expect(next.document.blocks[2]).toBe(index.document.blocks[2]);
    expect(next.commentContainerIndex).toBe(index.commentContainerIndex);
    expect([...next.commentContainerIndex.keys()]).toEqual(["root.0"]);
  });

  test("rebuilds comment container index when an unrelated edit introduces an ambiguous match", () => {
    const snapshot = withCommentAt(
      parseDocument(`commented target

outside text
`),
    );
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(index.document, 1, 1, [
      createParagraphTextBlock("commented target"),
    ]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 1);

    expect(next.commentContainerIndex).not.toBe(index.commentContainerIndex);
    expect([...next.commentContainerIndex.keys()]).toEqual([]);
  });

  test("checks changed roots against semantic comment-anchor text", () => {
    const snapshot = withCommentAt(
      parseDocument(`commented target

outside text
`),
    );
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(index.document, 1, 1, [
      createParagraphBlock([createMention({ name: "target", userId: "user-target" })]),
    ]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 1);

    expect(indexedTextEntries(next)[1]?.text).not.toContain("target");
    expect(next.document.blocks[1]?.plainText).toContain("target");
    expect(next.commentContainerIndex).not.toBe(index.commentContainerIndex);
    expect([...next.commentContainerIndex.keys()]).toEqual(["root.0"]);
  });

  test("rebuilds comment container index when editing a resolved comment root", () => {
    const snapshot = withCommentAt(
      parseDocument(`commented target

outside text
`),
    );
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(index.document, 0, 1, [
      createParagraphTextBlock("commented target edited"),
    ]);
    const next = spliceDocumentIndex(index, nextDocument, 0, 1);

    expect(next.commentContainerIndex).not.toBe(index.commentContainerIndex);
    expect([...next.commentContainerIndex.keys()]).toEqual(["root.0"]);
  });

  test("rebuilds comment container index when root insertion shifts a comment path", () => {
    const snapshot = withCommentAt(
      parseDocument(`intro text

commented target
`),
      1,
    );
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(index.document, 0, 0, [
      createParagraphTextBlock("inserted text"),
    ]);
    const next = spliceDocumentIndex(index, nextDocument, 0, 0);

    expect(next.commentContainerIndex).not.toBe(index.commentContainerIndex);
    expect([...next.commentContainerIndex.keys()]).toEqual(["root.2"]);
  });

  test("replaces a root range through the reducer", () => {
    const documentIndex = createDocumentIndex(parseDocument("alpha\n\nbeta\n"));
    const reduction = spliceDocument(documentIndex.document, 1, 1, [
      createParagraphTextBlock("omega"),
    ]);

    expect(serializeDocument(reduction)).toBe("alpha\n\nomega\n");
  });

  function expectDocumentIndexMaps(index: DocumentIndex) {
    expect(index.blockIndex.size).toBe(index.blocks.length);
    expect(index.tableCellIndex.size).toBe(
      index.blocks.reduce((count, block) => count + countIndexedTableCells(block), 0),
    );

    for (const block of index.blocks) {
      expect(index.blockIndex.get(block.path)).toBe(block);
      if (block.kind !== "cells") {
        continue;
      }

      for (const [rowIndex, row] of block.tableCellRows.entries()) {
        for (const [cellIndex, cell] of row.entries()) {
          expect(index.tableCellIndex.get(cell.path)).toBe(cell);
          expect(cell).toMatchObject({
            cellIndex,
            rowIndex,
            tablePath: block.path,
          });
        }
      }
    }

    for (const entry of indexedTextEntries(index)) {
      if (entry.tableCell) {
        const cell = index.tableCellIndex.get(entry.path);
        expect(cell).toBe(entry.tableCell);
        expect(cell?.text).toBe(entry.text);
        expect(cell?.inlines ?? null).toBe(entry.inlines);
      } else {
        const block = index.blockIndex.get(entry.path);
        const text = block?.kind === "inlines" || block?.kind === "source"
          ? block.text
          : null;
        const inlines = block?.kind === "inlines" ? block.inlines : null;
        expect(text).toBe(entry.text);
        expect(inlines).toBe(entry.inlines);
      }
    }

    expectDocumentIndexRanges(index);
  }

  function countIndexedTableCells(block: IndexedBlock) {
    return block.kind === "cells"
      ? block.tableCellRows.reduce((count, row) => count + row.length, 0)
      : 0;
  }

  function expectDocumentIndexRanges(index: DocumentIndex) {
    for (const root of index.roots) {
      const rootBlock = root.blocks[0];

      if (!rootBlock) {
        throw new Error("Expected each indexed root to include a root block");
      }

      expect(rootBlock.blockRangeEnd - rootBlock.blockArrayIndex).toBe(root.blocks.length);
    }

    for (const [arrayIndex, block] of index.blocks.entries()) {
      expect(block.blockArrayIndex).toBe(arrayIndex);
      expect(block.blockRangeEnd).toBeGreaterThan(block.blockArrayIndex);
      expect(block.blockRangeEnd).toBeLessThanOrEqual(index.blocks.length);
    }

    for (const parent of index.blocks) {
      for (const child of index.blocks) {
        const rangeContains =
          parent.blockArrayIndex <= child.blockArrayIndex &&
          child.blockRangeEnd <= parent.blockRangeEnd;

        expect(rangeContains).toBe(blockPathContainsPath(parent.path, child.path));
      }
    }
  }

  function withCommentAt(document: ReturnType<typeof parseDocument>, containerIndex = 0) {
    const container = listAnchorContainers(document)[containerIndex];

    if (!container) {
      throw new Error(`Expected anchor container ${containerIndex}`);
    }

    const startOffset = container.text.indexOf("target");
    const endOffset = startOffset + "target".length;
    const thread = createCommentThread({
      anchor: createAnchorFromContainer(container, startOffset, endOffset),
      body: "Track this target",
      createdAt: "2026-04-05T12:00:00.000Z",
      quote: extractQuoteFromContainer(container, startOffset, endOffset),
    });

    return {
      ...document,
      comments: [thread],
    };
  }
});
