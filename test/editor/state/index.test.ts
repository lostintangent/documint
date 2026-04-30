import { expect, test } from "bun:test";
import {
  createDocumentFromIndex,
  createDocumentIndex,
  normalizeSelection,
} from "@/editor/state";
import { spliceText } from "@/editor/state/reducer/text";
import { parseDocument, serializeDocument } from "@/markdown";

test("projects semantic snapshots into a deterministic editor document", () => {
  const snapshot = parseDocument(`# Runtime

Paragraph with [link](https://example.com), \`code\`, and ![alt text](https://example.com/image.png).

- alpha
- beta
`);
  const runtime = createDocumentIndex(snapshot);

  expect(runtime.engine).toBe("canvas");
  expect(runtime.blocks.map((block) => block.type)).toEqual([
    "heading",
    "paragraph",
    "list",
    "listItem",
    "paragraph",
    "listItem",
    "paragraph",
  ]);
  expect(runtime.regions.map((container) => container.text)).toEqual([
    "Runtime",
    "Paragraph with link, code, and \uFFFC.",
    "alpha",
    "beta",
  ]);
  expect(runtime.regions[1]?.inlines.map((run) => run.kind)).toEqual([
    "text",
    "text",
    "text",
    "inlineCode",
    "text",
    "image",
    "text",
  ]);
  expect(runtime.regions[1]?.inlines[1]?.link?.url).toBe("https://example.com");
  expect(runtime.regions[1]?.inlines[5]?.text).toBe("\uFFFC");
  expect(runtime.regions[1]?.inlines[5]?.image?.alt).toBe("alt text");
  expect(runtime.text).toContain("Paragraph with link, code, and \uFFFC.");
  expect(runtime.length).toBe(runtime.text.length);
});

test("preserves inline emphasis and strong marks in runtime text runs", () => {
  const runtime = createDocumentIndex(parseDocument("Plain *italic* and **bold** text.\n"));
  const paragraph = runtime.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  const italicRun = paragraph.inlines.find((run) => run.text === "italic");
  const boldRun = paragraph.inlines.find((run) => run.text === "bold");

  expect(italicRun?.marks).toEqual(["italic"]);
  expect(boldRun?.marks).toEqual(["bold"]);
});

test("preserves inline underline marks in runtime text runs", () => {
  const runtime = createDocumentIndex(parseDocument("Plain <ins>underlined</ins> text.\n"));
  const paragraph = runtime.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  const underlineRun = paragraph.inlines.find((run) => run.text === "underlined");

  expect(underlineRun?.marks).toEqual(["underline"]);
});

test("round-trips through editor model materialization without changing markdown", () => {
  const markdown = `# Canvas Runtime

> quoted

- [ ] task
`;
  const snapshot = parseDocument(markdown);
  const runtime = createDocumentIndex(snapshot);
  const roundTrip = createDocumentFromIndex(runtime);

  expect(serializeDocument(roundTrip)).toBe(markdown);
});

test("creates a runtime paragraph for an empty document without changing markdown persistence", () => {
  const snapshot = parseDocument("");
  const runtime = createDocumentIndex(snapshot);

  expect(runtime.regions).toHaveLength(1);
  expect(runtime.regions[0]?.text).toBe("");
  expect(runtime.document.blocks[0]?.type).toBe("paragraph");
  expect(serializeDocument(createDocumentFromIndex(runtime))).toBe("");
});

test("stores positioned root ranges directly on the unified editor model", () => {
  const runtime = createDocumentIndex(
    parseDocument(`# Heading

alpha

beta
`),
  );

  expect(runtime.roots).toHaveLength(3);
  expect(runtime.roots[0]?.start).toBe(0);
  expect(runtime.roots[0]?.regions[0]?.start).toBe(0);
  expect(runtime.roots[1]?.regions[0]?.start).toBe(runtime.roots[1]?.start);
  expect(runtime.roots[1]?.start).toBe(runtime.regions[1]?.start);
  expect(runtime.roots[2]?.start).toBe(runtime.regions[1]!.end + 1);
  expect(runtime.roots[2]?.regions[0]?.start).toBe(runtime.roots[2]?.start);
});

test("normalizes canvas selections and replaces plain text within one container", () => {
  const runtime = createDocumentIndex(
    parseDocument(`# Selection

Paragraph body.
`),
  );
  const paragraphContainer = runtime.regions[1];

  if (!paragraphContainer) {
    throw new Error("Expected paragraph container");
  }

  const normalized = normalizeSelection(runtime, {
    anchor: {
      regionId: paragraphContainer.id,
      offset: 12,
    },
    focus: {
      regionId: paragraphContainer.id,
      offset: 10,
    },
  });
  const replaced = spliceText(
    runtime,
    {
      anchor: {
        regionId: paragraphContainer.id,
        offset: 10,
      },
      focus: {
        regionId: paragraphContainer.id,
        offset: 14,
      },
    },
    "text",
  );

  expect(normalized.start.offset).toBe(10);
  expect(normalized.end.offset).toBe(12);
  expect(replaced.documentIndex.regions[1]?.text).toBe("Paragraph text.");
  expect(serializeDocument(replaced.documentIndex.document)).toContain("Paragraph text.");
});

test("preserves inline semantic wrappers when editing inside a formatted container", () => {
  const runtime = createDocumentIndex(
    parseDocument(
      "Paragraph with [link](https://example.com), `code`, and ![alt](https://example.com/image.png).\n",
    ),
  );
  const paragraph = runtime.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  const replacedLink = spliceText(
    runtime,
    {
      anchor: {
        regionId: paragraph.id,
        offset: "Paragraph with ".length,
      },
      focus: {
        regionId: paragraph.id,
        offset: "Paragraph with link".length,
      },
    },
    "ref",
  );
  const replacedCode = spliceText(
    replacedLink.documentIndex,
    {
      anchor: {
        regionId: replacedLink.documentIndex.regions[0]!.id,
        offset: "Paragraph with ref, ".length,
      },
      focus: {
        regionId: replacedLink.documentIndex.regions[0]!.id,
        offset: "Paragraph with ref, code".length,
      },
    },
    "snippet",
  );

  expect(serializeDocument(replacedCode.documentIndex.document)).toBe(
    "Paragraph with [ref](https://example.com), `snippet`, and ![alt](https://example.com/image.png).\n",
  );
});

test("reuses untouched runtime regions for same-length single-root edits", () => {
  const runtime = createDocumentIndex(
    parseDocument(`# Heading

alpha

beta
`),
  );
  const paragraph = runtime.regions[1];

  if (!paragraph) {
    throw new Error("Expected editable paragraph container");
  }

  const replaced = spliceText(
    runtime,
    {
      anchor: {
        regionId: paragraph.id,
        offset: 0,
      },
      focus: {
        regionId: paragraph.id,
        offset: paragraph.text.length,
      },
    },
    "omega",
  );

  expect(replaced.documentIndex.regions[0]).toBe(runtime.regions[0]);
  expect(replaced.documentIndex.regions[1]).not.toBe(paragraph);
  expect(replaced.documentIndex.regions[2]).toBe(runtime.regions[2]);
  expect(replaced.documentIndex.roots[0]).toBe(runtime.roots[0]);
  expect(replaced.documentIndex.roots[1]).not.toBe(runtime.roots[1]);
  expect(replaced.documentIndex.roots[2]).toBe(runtime.roots[2]);
});

test("preserves sibling root content when a preceding root shifts in document space", () => {
  const runtime = createDocumentIndex(
    parseDocument(`# Heading

alpha

beta
`),
  );
  const paragraph = runtime.regions[1];

  if (!paragraph) {
    throw new Error("Expected editable paragraph container");
  }

  const replaced = spliceText(
    runtime,
    {
      anchor: {
        regionId: paragraph.id,
        offset: 0,
      },
      focus: {
        regionId: paragraph.id,
        offset: paragraph.text.length,
      },
    },
    "alphabet",
  );

  expect(replaced.documentIndex.roots[2]).not.toBe(runtime.roots[2]);
  expect(replaced.documentIndex.roots[2]?.regions[0]?.id).toBe(runtime.roots[2]?.regions[0]?.id);
  expect(replaced.documentIndex.regions[2]?.start).toBe(runtime.regions[2]!.start + 3);
});

test("replaces a selected image atomically instead of editing its alt text", () => {
  const runtime = createDocumentIndex(
    parseDocument("before ![alt](https://example.com/image.png) after\n"),
  );
  const paragraph = runtime.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  const imageRun = paragraph.inlines.find((run) => run.kind === "image");

  if (!imageRun) {
    throw new Error("Expected image run");
  }

  const replaced = spliceText(
    runtime,
    {
      anchor: {
        regionId: paragraph.id,
        offset: imageRun.start,
      },
      focus: {
        regionId: paragraph.id,
        offset: imageRun.end,
      },
    },
    "media",
  );

  expect(serializeDocument(replaced.documentIndex.document)).toBe("before media after\n");
});
