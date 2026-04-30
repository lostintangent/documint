import { expect, test } from "bun:test";
import { createParagraphTextBlock, spliceDocument } from "@/document";
import {
  createDocumentIndex,
  buildEditorRoots,
  createEditorRoot,
  rebuildEditorRoot,
  spliceDocumentIndex,
} from "@/editor/state";
import { replaceEditorBlock } from "@/editor/state/index/build";
import { parseDocument, serializeDocument } from "@/markdown";

test("builds positioned editor roots directly on the unified model", () => {
  const snapshot = parseDocument(`# Heading

  alpha

beta
`);
  const roots = buildEditorRoots(
    snapshot.blocks.map((block, rootIndex) => createEditorRoot(block, rootIndex)),
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
  const original = createEditorRoot(snapshot.blocks[1]!, 1);
  const nextDocument = spliceDocument(snapshot, 1, 1, [
    createParagraphTextBlock({ text: "omega" }),
  ]);
  const rebuilt = rebuildEditorRoot(original, nextDocument.blocks[1]!);

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
  const nextDocument = spliceDocument(snapshot, 1, 1, [
    createParagraphTextBlock({ text: "alphabet" }),
  ]);
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
  const nextDocument = spliceDocument(snapshot, 1, 1, [
    createParagraphTextBlock({ text: "alphabet" }),
  ]);
  const next = spliceDocumentIndex(index, nextDocument, 1, 1);

  // The image-bearing root is reused (sibling edit), so its imageUrls
  // reference is reused. The document-level union value-compares to the
  // previous and reuses the reference too — so a downstream useEffect
  // depending on `documentIndex.imageUrls` does not refire.
  expect(next.roots[0]).toBe(index.roots[0]);
  expect(next.roots[0]!.imageUrls).toBe(index.roots[0]!.imageUrls);
  expect(next.imageUrls).toBe(index.imageUrls);
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
  const paragraph = documentIndex.blocks.find((block) => block.type === "paragraph");

  if (!paragraph) {
    throw new Error("Expected paragraph block");
  }

  const reduction = replaceEditorBlock(documentIndex, paragraph.id, () =>
    createParagraphTextBlock({ text: "beta" }),
  );

  if (!reduction) {
    throw new Error("Expected nested block replacement");
  }

  expect(serializeDocument(reduction)).toBe("- beta\n");
});

test("replaces a root range through the reducer", () => {
  const documentIndex = createDocumentIndex(parseDocument("alpha\n\nbeta\n"));
  const reduction = spliceDocument(documentIndex.document, 1, 1, [
    createParagraphTextBlock({ text: "omega" }),
  ]);

  expect(serializeDocument(reduction)).toBe("alpha\n\nomega\n");
});
