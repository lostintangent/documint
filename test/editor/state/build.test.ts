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
import { createDocumentIndex, spliceDocumentIndex, type DocumentIndex } from "@/editor/state";
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
    expect(roots.map((root) => root.regions[0]?.regionArrayIndex)).toEqual([0, 1, 2]);
    expect(runtime.roots[2]?.blocks[0]?.regionRangeStart).toBe(
      runtime.roots[1]?.blocks[0]?.regionRangeEnd,
    );
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
    expect(rebuilt.regions[0]?.path).toBe("root.1.children");
    expect(rebuilt.regions[0]?.text).toBe("omega");
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
    expect(replacedModel.roots[2]?.regions[0]?.path).toBe(model.roots[2]?.regions[0]?.path);
    expect(replaced.roots[0]).toBe(runtime.roots[0]);
    expect(replaced.roots[1]).not.toBe(runtime.roots[1]);
    expect(replaced.roots[2]).toBe(runtime.roots[2]);
    expect(replaced.roots[2]?.regions[0]?.path).toBe(runtime.roots[2]?.regions[0]?.path);
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
    expect(next.roots[1]?.regions[0]).toBe(index.roots[1]?.regions[0]);
    expect(next.roots[2]).toBe(index.roots[2]);
    expect(next.roots[2]?.blocks[0]).toBe(index.roots[2]?.blocks[0]);
    expect(next.roots[2]?.regions[0]).toBe(index.roots[2]?.regions[0]);
    expectDocumentIndexMaps(next);
  });

  test("re-stamps suffix block records when region order shifts", () => {
    const snapshot = parseDocument(`alpha

---

beta
`);
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("middle")]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 1);

    expect(next.roots[2]).not.toBe(index.roots[2]);
    expect(next.roots[2]?.blocks[0]).not.toBe(index.roots[2]?.blocks[0]);
    expect(next.roots[2]?.blocks[0]?.regionRangeStart).toBe(
      index.roots[2]!.blocks[0]!.regionRangeStart + 1,
    );
    expect(next.roots[2]?.regions[0]).not.toBe(index.roots[2]?.regions[0]);
    expect(next.roots[2]?.regions[0]?.regionArrayIndex).toBe(
      index.roots[2]!.regions[0]!.regionArrayIndex + 1,
    );
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
    expect(next.regions).toHaveLength(2);
    expectDocumentIndexMaps(next);
  });

  test("keeps region paths stable for in-place content edits", () => {
    const index = createDocumentIndex(parseDocument("alpha\n"));
    const region = index.regions[0];

    if (!region) {
      throw new Error("Expected editable region");
    }

    const next = replaceEditorBlock(index, region.blockPath, () =>
      createParagraphTextBlock("alphabet"),
    );

    expect(next?.regions[0]?.path).toBe(region.path);
    expect(next?.regions[0]?.blockPath).toBe(region.blockPath);
    expect(next?.regions[0]?.text).toBe("alphabet");
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

  test("tracks table region block paths separately from cell paths", () => {
    const index = createDocumentIndex(parseDocument(`| A |\n| - |\n| B |\n`));
    const table = index.blocks.find((entry) => entry.block.type === "table");
    const cellRegion = index.regions.find((region) => region.tableCellPosition !== null);

    if (!table || !cellRegion) {
      throw new Error("Expected table cell region");
    }

    expect(cellRegion.blockPath).toBe(table.path);
    expect(cellRegion.containerPath).toBe(cellRegion.path);
    expect(index.blockIndex.get(cellRegion.blockPath)).toBe(table);
  });

  test("stamps nested block and region ranges", () => {
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
    expect(blockquote.regionRangeEnd - blockquote.regionRangeStart).toBe(2);
    expect(list.regionRangeEnd - list.regionRangeStart).toBe(1);
    expect(divider.regionRangeStart).toBe(divider.regionRangeEnd);
    expect(table.regionRangeEnd - table.regionRangeStart).toBe(2);
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
    expect(next.regions[0]).toBe(index.regions[0]);
    expect(next.regions[1]).not.toBe(index.regions[1]);
    expect(next.regions[2]).toBe(index.regions[2]);
    expectDocumentIndexMaps(next);
  });

  test("keeps flat region arrays exact when replacing regionless roots", () => {
    const snapshot = parseDocument(`alpha

---

beta
`);
    const index = createDocumentIndex(snapshot);
    const withMiddleText = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("middle")]);
    const insertedRegion = spliceDocumentIndex(index, withMiddleText, 1, 1);

    expect(insertedRegion.regions.map((region) => region.text)).toEqual([
      "alpha",
      "middle",
      "beta",
    ]);
    expectDocumentIndexMaps(insertedRegion);

    const withoutMiddleText = spliceDocument(withMiddleText, 1, 1, [createDividerBlock()]);
    const removedRegion = spliceDocumentIndex(insertedRegion, withoutMiddleText, 1, 1);

    expect(removedRegion.regions.map((region) => region.text)).toEqual(["alpha", "beta"]);
    expectDocumentIndexMaps(removedRegion);
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
    // Roots, blocks, regions and lookup maps all keep reference identity —
    // the metadata fast path doesn't allocate any of them.
    expect(next.roots).toBe(index.roots);
    expect(next.blocks).toBe(index.blocks);
    expect(next.regions).toBe(index.regions);
    expect(next.blockIndex).toBe(index.blockIndex);
    expect(next.regionIndex).toBe(index.regionIndex);
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

    expect(next.regions[1]?.text).not.toContain("target");
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
    expect(index.regionIndex.size).toBe(index.regions.length);

    for (const block of index.blocks) {
      expect(index.blockIndex.get(block.path)).toBe(block);
    }

    for (const region of index.regions) {
      expect(index.regionIndex.get(region.path)).toBe(region);
    }

    expectDocumentIndexRanges(index);
  }

  function expectDocumentIndexRanges(index: DocumentIndex) {
    for (const root of index.roots) {
      const rootBlock = root.blocks[0];

      if (!rootBlock) {
        throw new Error("Expected each indexed root to include a root block");
      }

      expect(rootBlock.blockRangeEnd - rootBlock.blockArrayIndex).toBe(root.blocks.length);
      expect(rootBlock.regionRangeEnd - rootBlock.regionRangeStart).toBe(root.regions.length);
    }

    for (const [arrayIndex, block] of index.blocks.entries()) {
      expect(block.blockArrayIndex).toBe(arrayIndex);
      expect(block.blockRangeEnd).toBeGreaterThan(block.blockArrayIndex);
      expect(block.blockRangeEnd).toBeLessThanOrEqual(index.blocks.length);
      expect(block.regionRangeStart).toBeGreaterThanOrEqual(0);
      expect(block.regionRangeStart).toBeLessThanOrEqual(block.regionRangeEnd);
      expect(block.regionRangeEnd).toBeLessThanOrEqual(index.regions.length);
    }

    for (const parent of index.blocks) {
      for (const child of index.blocks) {
        const rangeContains =
          parent.blockArrayIndex <= child.blockArrayIndex &&
          child.blockRangeEnd <= parent.blockRangeEnd;

        expect(rangeContains).toBe(blockPathContainsPath(parent.path, child.path));
      }

      for (const region of index.regions) {
        const rangeContains =
          parent.regionRangeStart <= region.regionArrayIndex &&
          region.regionArrayIndex < parent.regionRangeEnd;

        expect(rangeContains).toBe(blockPathContainsPath(parent.path, region.path));
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
