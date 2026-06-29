import { describe, expect, test } from "bun:test";
import {
  commitDocument,
  createDocumentIndex,
  findUniqueEditableRegion,
  hasSameEditableRegionShape,
  hasSameTableCellPosition,
  indexedInlineText,
  normalizeSelection,
  regionInlines,
} from "@/editor/state";
import {
  plainTextOffsetToRegionOffset,
  regionOffsetToPlainTextOffset,
} from "@/editor/state/index/inlines";
import { createDocument, createMention, createParagraphBlock, createText } from "@/document";
import { spliceText } from "@/editor/state/reducer/text";
import { parseDocument, serializeDocument } from "@/markdown";

describe("Editor state index", () => {
  test("projects semantic snapshots into a deterministic editor document", () => {
    const snapshot = parseDocument(`# Runtime

Paragraph with [link](https://example.com), \`code\`, @[Jane Doe](user-123), and ![alt text](https://example.com/image.png).

- alpha
- beta
`);
    const runtime = createDocumentIndex(snapshot);

    expect(runtime.blocks.map((entry) => entry.block.type)).toEqual([
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
      "Paragraph with link, code, \uFFFC, and \uFFFC.",
      "alpha",
      "beta",
    ]);
    const paragraphInlines = regionInlines(runtime.regions[1]!);
    expect(paragraphInlines.map((run) => run.node.type)).toEqual([
      "text",
      "text",
      "text",
      "text",
      "text",
      "mention",
      "text",
      "image",
      "text",
    ]);
    expect(paragraphInlines[1]?.link?.url).toBe("https://example.com");
    expect(paragraphInlines[3]?.node.type === "text" && paragraphInlines[3].node.marks).toEqual([
      "code",
    ]);
    expect(paragraphInlines[5] ? indexedInlineText(paragraphInlines[5]) : null).toBe("\uFFFC");
    const mentionNode = paragraphInlines[5]?.node;
    expect(mentionNode?.type === "mention" && mentionNode.name).toBe("Jane Doe");
    expect(mentionNode?.type === "mention" && mentionNode.userId).toBe("user-123");
    expect(paragraphInlines[7] ? indexedInlineText(paragraphInlines[7]) : null).toBe("\uFFFC");
    const imageNode = paragraphInlines[7]?.node;
    expect(imageNode?.type === "image" && imageNode.alt).toBe("alt text");
  });

  test("preserves inline emphasis and strong marks in runtime text runs", () => {
    const runtime = createDocumentIndex(parseDocument("Plain *italic* and **bold** text.\n"));
    const paragraph = runtime.regions[0];

    if (!paragraph) {
      throw new Error("Expected paragraph container");
    }

    const italicRun = regionInlines(paragraph).find((run) => indexedInlineText(run) === "italic");
    const boldRun = regionInlines(paragraph).find((run) => indexedInlineText(run) === "bold");

    expect(italicRun?.node.type === "text" && italicRun.node.marks).toEqual(["italic"]);
    expect(boldRun?.node.type === "text" && boldRun.node.marks).toEqual(["bold"]);
  });

  test("preserves inline underline marks in runtime text runs", () => {
    const runtime = createDocumentIndex(parseDocument("Plain <ins>underlined</ins> text.\n"));
    const paragraph = runtime.regions[0];

    if (!paragraph) {
      throw new Error("Expected paragraph container");
    }

    const underlineRun = regionInlines(paragraph).find(
      (run) => indexedInlineText(run) === "underlined",
    );

    expect(underlineRun?.node.type === "text" && underlineRun.node.marks).toEqual(["underline"]);
  });

  test("converts offsets between runtime region text and semantic plain text", () => {
    const runtime = createDocumentIndex(
      createDocument([
        createParagraphBlock([
          createText("Hello "),
          createMention({ name: "Jane Doe", userId: "user-123" }),
          createText(" world"),
        ]),
      ]),
    );
    const region = runtime.regions[0];
    if (!region) {
      throw new Error("Expected mention region");
    }

    expect(region.text).not.toContain("@Jane Doe");
    expect(regionOffsetToPlainTextOffset(region, "Hello ".length)).toBe("Hello ".length);
    expect(regionOffsetToPlainTextOffset(region, "Hello ".length + 1)).toBe(
      "Hello @Jane Doe".length,
    );
    expect(
      plainTextOffsetToRegionOffset(region, "Hello ".length, "before"),
    ).toBe("Hello ".length);
    expect(
      plainTextOffsetToRegionOffset(region, "Hello @Jane Doe".length, "after"),
    ).toBe("Hello ".length + 1);
    expect(
      plainTextOffsetToRegionOffset(region, "Hello @Jane".length, "before"),
    ).toBe("Hello ".length);
    expect(
      plainTextOffsetToRegionOffset(region, "Hello @Jane".length, "after"),
    ).toBe("Hello ".length + 1);
  });

  test("exposes neutral editable region projection queries", () => {
    const runtime = createDocumentIndex(
      parseDocument(`alpha

beta

| A | B |
| - | - |
| one | two |
`),
    );
    const alpha = runtime.regions[0];
    const beta = runtime.regions[1];
    const one = runtime.regions.find((region) => region.text === "one");
    const two = runtime.regions.find((region) => region.text === "two");

    if (!alpha || !beta || !one || !two) {
      throw new Error("Expected paragraph and table-cell regions");
    }

    expect(alpha.path).not.toBe(beta.path);
    expect(hasSameEditableRegionShape(alpha, beta)).toBe(true);
    expect(hasSameTableCellPosition(one, two)).toBe(false);
    expect(hasSameEditableRegionShape(one, two)).toBe(false);
    expect(findUniqueEditableRegion(runtime, (region) => region.text === "beta")).toBe(beta);
    expect(
      findUniqueEditableRegion(runtime, (region) => region.block.type === "paragraph"),
    ).toBeNull();
  });

  test("round-trips through editor model materialization without changing markdown", () => {
    const markdown = `# Canvas Runtime

> quoted

- [ ] task
`;
    const snapshot = parseDocument(markdown);
    const runtime = createDocumentIndex(snapshot);
    const roundTrip = commitDocument(runtime);

    expect(serializeDocument(roundTrip)).toBe(markdown);
  });

  test("creates a runtime paragraph for an empty document without changing markdown persistence", () => {
    const snapshot = parseDocument("");
    const runtime = createDocumentIndex(snapshot);

    expect(runtime.regions).toHaveLength(1);
    expect(runtime.regions[0]?.text).toBe("");
    expect(runtime.document.blocks[0]?.type).toBe("paragraph");
    expect(serializeDocument(commitDocument(runtime))).toBe("");
  });

  test("stores positioned block and region order on the unified editor model", () => {
    const runtime = createDocumentIndex(
      parseDocument(`# Heading

alpha

beta
`),
    );

    expect(runtime.roots).toHaveLength(3);
    expect(runtime.roots.map((root) => root.blocks[0]?.blockArrayIndex)).toEqual([0, 1, 2]);
    expect(runtime.roots.map((root) => root.blocks[0]?.regionRangeStart)).toEqual([0, 1, 2]);
    expect(runtime.regions.map((region) => region.regionArrayIndex)).toEqual([0, 1, 2]);
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
        regionPath: paragraphContainer.path,
        offset: 12,
      },
      focus: {
        regionPath: paragraphContainer.path,
        offset: 10,
      },
    });
    const replaced = spliceText(
      runtime,
      {
        anchor: {
          regionPath: paragraphContainer.path,
          offset: 10,
        },
        focus: {
          regionPath: paragraphContainer.path,
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
          regionPath: paragraph.path,
          offset: "Paragraph with ".length,
        },
        focus: {
          regionPath: paragraph.path,
          offset: "Paragraph with link".length,
        },
      },
      "ref",
    );
    const replacedCode = spliceText(
      replacedLink.documentIndex,
      {
        anchor: {
          regionPath: replacedLink.documentIndex.regions[0]!.path,
          offset: "Paragraph with ref, ".length,
        },
        focus: {
          regionPath: replacedLink.documentIndex.regions[0]!.path,
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
          regionPath: paragraph.path,
          offset: 0,
        },
        focus: {
          regionPath: paragraph.path,
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

  test("preserves sibling root content when a preceding root changes text length", () => {
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
          regionPath: paragraph.path,
          offset: 0,
        },
        focus: {
          regionPath: paragraph.path,
          offset: paragraph.text.length,
        },
      },
      "alphabet",
    );

    expect(replaced.documentIndex.roots[2]).toBe(runtime.roots[2]);
    expect(replaced.documentIndex.roots[2]?.regions[0]?.path).toBe(runtime.roots[2]?.regions[0]?.path);
    expect(replaced.documentIndex.regions[2]).toBe(runtime.regions[2]);
  });

  test("replaces a selected image atomically instead of editing its alt text", () => {
    const runtime = createDocumentIndex(
      parseDocument("before ![alt](https://example.com/image.png) after\n"),
    );
    const paragraph = runtime.regions[0];

    if (!paragraph) {
      throw new Error("Expected paragraph container");
    }

    const imageRun = regionInlines(paragraph).find((run) => run.node.type === "image");

    if (!imageRun) {
      throw new Error("Expected image run");
    }

    const replaced = spliceText(
      runtime,
      {
        anchor: {
          regionPath: paragraph.path,
          offset: imageRun.start,
        },
        focus: {
          regionPath: paragraph.path,
          offset: imageRun.end,
        },
      },
      "media",
    );

    expect(serializeDocument(replaced.documentIndex.document)).toBe("before media after\n");
  });
});
