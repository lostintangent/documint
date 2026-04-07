import { expect, test } from "bun:test";
import { buildSyntheticLongFixture, sampleMarkdown } from "@test/utils";
import { createDocumentEditor } from "@/editor/model/document-editor";
import { createDocumentLayout, createDocumentViewport } from "@/editor/layout";
import { parseMarkdown } from "@/markdown";

test("creates a viewport layout slice smaller than the full long-document layout", () => {
  const snapshot = parseMarkdown(buildSyntheticLongFixture(sampleMarkdown, 80));
  const runtime = createDocumentEditor(snapshot);
  const fullLayout = createDocumentLayout(runtime, {
    width: 420,
  });
  const viewportLayout = createDocumentViewport(
    runtime,
    {
      width: 420,
    },
    {
      height: 720,
      overscan: 720,
      top: 0,
    },
  );

  expect(viewportLayout.layout.lines.length).toBeLessThan(fullLayout.lines.length);
  expect(viewportLayout.totalHeight).toBeGreaterThan(720);
});

test("keeps pinned regions in the viewport slice", () => {
  const snapshot = parseMarkdown(buildSyntheticLongFixture(sampleMarkdown, 40));
  const runtime = createDocumentEditor(snapshot);
  const pinnedContainer = runtime.regions.at(-1);

  if (!pinnedContainer) {
    throw new Error("Expected pinned runtime container");
  }

  const viewportLayout = createDocumentViewport(
    runtime,
    {
      width: 420,
    },
    {
      height: 720,
      overscan: 720,
      top: 0,
    },
    [pinnedContainer.id],
  );

  expect(viewportLayout.layout.regionLineIndices.has(pinnedContainer.id)).toBeTrue();
});
