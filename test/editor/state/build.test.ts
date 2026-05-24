import { describe, expect, test } from "bun:test";
import { createDividerBlock, createParagraphTextBlock, spliceDocument } from "@/document";
import { createDocumentIndex, spliceDocumentIndex, type DocumentIndex } from "@/editor/state";
import { createRootEntry, positionRootEntries, rebuildRootEntry } from "@/editor/state/index/roots";
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
    const roots = positionRootEntries(
      snapshot.blocks.map((block, rootIndex) => createRootEntry(block, rootIndex)),
    );
    const runtime = createDocumentIndex(snapshot);

    expect(roots).toHaveLength(3);
    expect(roots[0]?.regions[0]?.start).toBe(0);
    expect(roots[1]?.regions[0]?.start).toBe(roots[1]?.start);
    expect(runtime.roots[1]?.start).toBe(runtime.roots[0]!.end + 1);
    expect(runtime.roots[2]?.start).toBe(runtime.roots[1]!.end + 1);
    expect(runtime.roots[2]?.regionRange?.start).toBe(runtime.roots[1]?.regionRange?.end);
  });

  test("rebuilds a root model against a normalized replacement root", () => {
    const snapshot = parseDocument(`# Heading

alpha
`);
    const original = createRootEntry(snapshot.blocks[1]!, 1);
    const nextDocument = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("omega")]);
    const rebuilt = rebuildRootEntry(original, nextDocument.blocks[1]!);

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
    expect(replacedModel.roots[2]).not.toBe(model.roots[2]);
    expect(replacedModel.roots[2]?.regions[0]?.id).toBe(model.roots[2]?.regions[0]?.id);
    expect(replaced.roots[0]).toBe(runtime.roots[0]);
    expect(replaced.roots[1]).not.toBe(runtime.roots[1]);
    expect(replaced.roots[2]).not.toBe(runtime.roots[2]);
    expect(replaced.roots[2]?.regions[0]?.id).toBe(runtime.roots[2]?.regions[0]?.id);
    expect(replaced.regions[2]?.start).toBe(runtime.regions[2]!.start + 3);
    expectDocumentIndexMaps(replacedModel);
    expectDocumentIndexMaps(replaced);
  });

  test("keeps lookup maps exact when replacing a root with new ids", () => {
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

  test("keeps lookup maps exact when inserting a root", () => {
    const snapshot = parseDocument(`alpha

beta
`);
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(snapshot, 1, 0, [createParagraphTextBlock("")]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 0);

    expect(next.blocks.map((entry) => entry.block.plainText)).toEqual(["alpha", "", "beta"]);
    expectDocumentIndexMaps(next);
  });

  test("preserves unchanged flat entries on same-length root replacement", () => {
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

  test("preserves list marker projections across unrelated root edits", () => {
    const snapshot = parseDocument(`1. alpha
2. beta

plain
`);
    const index = createDocumentIndex(snapshot);
    const nextDocument = spliceDocument(snapshot, 1, 1, [createParagraphTextBlock("updated")]);
    const next = spliceDocumentIndex(index, nextDocument, 1, 1);

    expect(next.roots[0]?.listItemMarkers).toBe(index.roots[0]?.listItemMarkers);
    expect(next.listItemMarkers).toBe(index.listItemMarkers);
    expect([...next.listItemMarkers.values()]).toEqual([
      { depth: 0, kind: "ordered", ordinal: 1 },
      { depth: 0, kind: "ordered", ordinal: 2 },
    ]);
    expectDocumentIndexMaps(next);
  });

  test("projects nested unordered list markers as structural semantics", () => {
    const index = createDocumentIndex(
      parseDocument(`- top
  - child
    - grandchild
`),
    );

    expect([...index.listItemMarkers.values()]).toEqual([
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
    const paragraph = documentIndex.blocks.find((entry) => entry.block.type === "paragraph");

    if (!paragraph) {
      throw new Error("Expected paragraph block");
    }

    const reduction = replaceEditorBlock(documentIndex, paragraph.block.id, () =>
      createParagraphTextBlock("beta"),
    );

    if (!reduction) {
      throw new Error("Expected nested block replacement");
    }

    expect(serializeDocument(commitDocument(reduction))).toBe("- beta\n");
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
    expect(next.regionPathIndex).toBe(index.regionPathIndex);
    expect(next.imageUrls).toBe(index.imageUrls);
    // listItemMarkers reuses when document.blocks identity holds.
    expect(next.listItemMarkers).toBe(index.listItemMarkers);
    // commentContainerIndex reuses when document.comments identity holds.
    expect(next.commentContainerIndex).toBe(index.commentContainerIndex);
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
    expect(index.regionPathIndex.size).toBe(index.regions.length);

    for (const block of index.blocks) {
      expect(index.blockIndex.get(block.block.id)).toBe(block);
    }

    for (const region of index.regions) {
      expect(index.regionIndex.get(region.id)).toBe(region);
      expect(index.regionPathIndex.get(region.path)).toBe(region);
    }
  }
});
