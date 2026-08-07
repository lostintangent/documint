import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import {
  commitDocument,
  createDocumentIndex,
  hasSameEditorTextPathShape,
  indexedInlineText,
  normalizeSelection,
  resolveAdjacentEditorPathWithTextInFlow,
  resolveAdjacentEditorPathWithTextOutsideBlock,
  resolveBlockTextPathBoundary,
  resolveDocumentTextPathBoundary,
  resolveInlinesAtPath,
  resolveIndexedBlockContainingPath,
  resolveIndexedText,
  resolveIndexedTableCell,
  resolveEditorTextAtPath,
  type DocumentIndex,
} from "@/editor/state";
import {
  indexedOffsetToPlainTextOffset,
  plainTextOffsetToIndexedOffset,
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
    expect(indexedTextEntries(runtime).map((container) => container.text)).toEqual([
      "Runtime",
      "Paragraph with link, code, \uFFFC, and \uFFFC.",
      "alpha",
      "beta",
    ]);
    const paragraphInlines = indexedTextEntries(runtime)[1]!.inlines ?? [];
    expect(paragraphInlines.map((inline) => inline.node.type)).toEqual([
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

  test("preserves inline emphasis and strong marks in runtime inlines", () => {
    const runtime = createDocumentIndex(parseDocument("Plain *italic* and **bold** text.\n"));
    const paragraph = indexedTextEntries(runtime)[0];

    if (!paragraph) {
      throw new Error("Expected paragraph container");
    }

    const italicInline = (paragraph.inlines ?? []).find(
      (inline) => indexedInlineText(inline) === "italic",
    );
    const boldInline = (paragraph.inlines ?? []).find(
      (inline) => indexedInlineText(inline) === "bold",
    );

    expect(italicInline?.node.type === "text" && italicInline.node.marks).toEqual(["italic"]);
    expect(boldInline?.node.type === "text" && boldInline.node.marks).toEqual(["bold"]);
  });

  test("preserves inline underline marks in runtime inlines", () => {
    const runtime = createDocumentIndex(parseDocument("Plain <ins>underlined</ins> text.\n"));
    const paragraph = indexedTextEntries(runtime)[0];

    if (!paragraph) {
      throw new Error("Expected paragraph container");
    }

    const underlineInline = (paragraph.inlines ?? []).find(
      (inline) => indexedInlineText(inline) === "underlined",
    );

    expect(underlineInline?.node.type === "text" && underlineInline.node.marks).toEqual([
      "underline",
    ]);
  });

  test("converts offsets between indexed editor text and semantic plain text", () => {
    const runtime = createDocumentIndex(
      createDocument([
        createParagraphBlock([
          createText("Hello "),
          createMention({ name: "Jane Doe", userId: "user-123" }),
          createText(" world"),
        ]),
      ]),
    );
    const path = indexedTextEntries(runtime)[0];
    if (!path) {
      throw new Error("Expected mention path");
    }

    expect(path.text).not.toContain("@Jane Doe");
    expect(indexedOffsetToPlainTextOffset(path.text, path.inlines, "Hello ".length)).toBe(
      "Hello ".length,
    );
    expect(indexedOffsetToPlainTextOffset(path.text, path.inlines, "Hello ".length + 1)).toBe(
      "Hello @Jane Doe".length,
    );
    expect(plainTextOffsetToIndexedOffset(path.text, path.inlines, "Hello ".length, "before")).toBe(
      "Hello ".length,
    );
    expect(
      plainTextOffsetToIndexedOffset(path.text, path.inlines, "Hello @Jane Doe".length, "after"),
    ).toBe("Hello ".length + 1);
    expect(
      plainTextOffsetToIndexedOffset(path.text, path.inlines, "Hello @Jane".length, "before"),
    ).toBe("Hello ".length);
    expect(
      plainTextOffsetToIndexedOffset(path.text, path.inlines, "Hello @Jane".length, "after"),
    ).toBe("Hello ".length + 1);
  });

  test("resolves paths with editor text through the block and table-cell indexes", () => {
    const runtime = createDocumentIndex(
      parseDocument(`alpha

beta

| A | B |
| - | - |
| one | two |
`),
    );
    const alpha = indexedTextEntries(runtime)[0];
    const beta = indexedTextEntries(runtime)[1];
    const one = indexedTextEntries(runtime).find((entry) => entry.text === "one");
    const two = indexedTextEntries(runtime).find((entry) => entry.text === "two");

    if (!alpha || !beta || !one || !two) {
      throw new Error("Expected paragraph and table-cell paths");
    }

    expect(alpha.path).not.toBe(beta.path);
    expect(resolveIndexedBlockContainingPath(runtime, alpha.path)?.path).toBe(alpha.blockPath);
    expect(resolveIndexedBlockContainingPath(runtime, beta.path)?.path).toBe(beta.blockPath);
    expect(resolveIndexedBlockContainingPath(runtime, one.path)?.path).toBe(one.blockPath);
    expect(resolveIndexedTableCell(runtime, one.path)).toMatchObject({
      cellIndex: 0,
      rowIndex: 1,
      tablePath: one.blockPath,
    });
    expect(resolveIndexedTableCell(runtime, two.path)).toMatchObject({
      cellIndex: 1,
      rowIndex: 1,
      tablePath: two.blockPath,
    });
    expect(indexedTextEntries(runtime).filter((entry) => entry.text === "beta")).toEqual([beta]);
    expect(
      indexedTextEntries(runtime).filter((entry) => entry.block.type === "paragraph"),
    ).toHaveLength(2);
  });

  test("uses canonical block and table-cell paths for editor text", () => {
    const runtime = createDocumentIndex(
      parseDocument(`> nested

\`\`\`ts
const x = 1
\`\`\`

| A | B |
| - | - |
| one | two |
`),
    );

    expect(indexedTextEntries(runtime).map((path) => path.path)).toEqual([
      "root.0.children.0",
      "root.1",
      "root.2.rows.0.cells.0",
      "root.2.rows.0.cells.1",
      "root.2.rows.1.cells.0",
      "root.2.rows.1.cells.1",
    ]);
    expect(resolveIndexedText(runtime, "root.0.children.0")).not.toBeNull();
    expect(resolveIndexedText(runtime, "root.0.children.0.children")).toBeNull();
    expect(resolveIndexedText(runtime, "root.1")).not.toBeNull();
    expect(resolveIndexedText(runtime, "root.1.source")).toBeNull();
    expect(resolveIndexedTableCell(runtime, "root.2.rows.1.cells.1")).not.toBeNull();
    expect(resolveIndexedText(runtime, "root.2")).toBeNull();

    expect(resolveEditorTextAtPath(runtime, "root.0.children.0")).toBe("nested");
    expect(resolveEditorTextAtPath(runtime, "root.1")).toBe("const x = 1");
    expect(resolveEditorTextAtPath(runtime, "root.2.rows.1.cells.1")).toBe("two");
    expect(resolveInlinesAtPath(runtime, "root.1")).toBeNull();
    expect(resolveInlinesAtPath(runtime, "root.2.rows.1.cells.1")?.map(indexedInlineText)).toEqual([
      "two",
    ]);
    expect(resolveIndexedText(runtime, "root.1")).toMatchObject({
      kind: "source",
      text: "const x = 1",
    });
    expect(resolveIndexedTableCell(runtime, "root.2.rows.1.cells.1")).toMatchObject({
      path: "root.2.rows.1.cells.1",
      cellIndex: 1,
      inlines: expect.any(Array),
      rowIndex: 1,
      tablePath: "root.2",
      text: "two",
    });
    expect(resolveIndexedText(runtime, "root.2")).toBeNull();
    expect(hasSameEditorTextPathShape(runtime, "root.1", runtime, "root.1")).toBe(true);
    expect(
      hasSameEditorTextPathShape(
        runtime,
        "root.2.rows.1.cells.1",
        runtime,
        "root.2.rows.1.cells.1",
      ),
    ).toBe(true);
    expect(hasSameEditorTextPathShape(runtime, "root.2", runtime, "root.2")).toBe(false);
    expect(resolveIndexedBlockContainingPath(runtime, "root.2.rows.1.cells.1")?.path).toBe(
      "root.2",
    );
    expect(resolveIndexedTableCell(runtime, "root.2.rows.1.cells.1")).toMatchObject({
      cellIndex: 1,
      rowIndex: 1,
      tablePath: "root.2",
    });
  });

  test("resolves editor path flow from blocks and table-local cells", () => {
    const runtime = createDocumentIndex(
      parseDocument(`- top
  - nested

| A | B |
| - | - |
| C | D |

---

omega
`),
    );
    const top = findEditorPathByText(runtime, "top");
    const nested = findEditorPathByText(runtime, "nested");
    const firstCell = findEditorPathByText(runtime, "A");
    const secondCell = findEditorPathByText(runtime, "B");
    const lastCell = findEditorPathByText(runtime, "D");
    const omega = findEditorPathByText(runtime, "omega");
    const table = runtime.blocks.find((entry) => entry.block.type === "table");

    if (!top || !nested || !firstCell || !secondCell || !lastCell || !omega || !table) {
      throw new Error("Expected indexed flow paths");
    }

    expect(resolveDocumentTextPathBoundary(runtime, "start")).toBe(top);
    expect(resolveDocumentTextPathBoundary(runtime, "end")).toBe(omega);
    expect(resolveBlockTextPathBoundary(runtime, "root.0", "start")).toBe(top);
    expect(resolveBlockTextPathBoundary(runtime, "root.0", "end")).toBe(nested);
    expect(resolveAdjacentEditorPathWithTextInFlow(runtime, nested, 1)).toBe(firstCell);
    expect(resolveAdjacentEditorPathWithTextInFlow(runtime, firstCell, -1)).toBe(nested);
    expect(resolveAdjacentEditorPathWithTextInFlow(runtime, firstCell, 1)).toBe(secondCell);
    expect(resolveAdjacentEditorPathWithTextInFlow(runtime, lastCell, 1)).toBe(omega);
    expect(resolveAdjacentEditorPathWithTextOutsideBlock(runtime, table.path, -1)).toBe(nested);
    expect(resolveAdjacentEditorPathWithTextOutsideBlock(runtime, table.path, 1)).toBe(omega);
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

    expect(indexedTextEntries(runtime)).toHaveLength(1);
    expect(indexedTextEntries(runtime)[0]?.text).toBe("");
    expect(runtime.document.blocks[0]?.type).toBe("paragraph");
    expect(serializeDocument(commitDocument(runtime))).toBe("");
  });

  test("stores positioned block order on the unified editor model", () => {
    const runtime = createDocumentIndex(
      parseDocument(`# Heading

alpha

beta
`),
    );

    expect(runtime.roots).toHaveLength(3);
    expect(runtime.roots.map((root) => root.blocks[0]?.blockArrayIndex)).toEqual([0, 1, 2]);
    expect(indexedTextEntries(runtime).map((entry) => entry.path)).toEqual([
      "root.0",
      "root.1",
      "root.2",
    ]);
  });

  test("normalizes canvas selections and replaces plain text within one container", () => {
    const runtime = createDocumentIndex(
      parseDocument(`# Selection

Paragraph body.
`),
    );
    const paragraphContainer = indexedTextEntries(runtime)[1];

    if (!paragraphContainer) {
      throw new Error("Expected paragraph container");
    }

    const normalized = normalizeSelection(runtime, {
      anchor: {
        path: paragraphContainer.path,
        offset: 12,
      },
      focus: {
        path: paragraphContainer.path,
        offset: 10,
      },
    });
    const replaced = spliceText(
      runtime,
      {
        anchor: {
          path: paragraphContainer.path,
          offset: 10,
        },
        focus: {
          path: paragraphContainer.path,
          offset: 14,
        },
      },
      "text",
    )!;

    expect(normalized.start.offset).toBe(10);
    expect(normalized.end.offset).toBe(12);
    expect(indexedTextEntries(replaced.documentIndex)[1]?.text).toBe("Paragraph text.");
    expect(serializeDocument(replaced.documentIndex.document)).toContain("Paragraph text.");
  });

  test("preserves inline semantic wrappers when editing inside a formatted container", () => {
    const runtime = createDocumentIndex(
      parseDocument(
        "Paragraph with [link](https://example.com), `code`, and ![alt](https://example.com/image.png).\n",
      ),
    );
    const paragraph = indexedTextEntries(runtime)[0];

    if (!paragraph) {
      throw new Error("Expected paragraph container");
    }

    const replacedLink = spliceText(
      runtime,
      {
        anchor: {
          path: paragraph.path,
          offset: "Paragraph with ".length,
        },
        focus: {
          path: paragraph.path,
          offset: "Paragraph with link".length,
        },
      },
      "ref",
    )!;
    const replacedCode = spliceText(
      replacedLink.documentIndex,
      {
        anchor: {
          path: indexedTextEntries(replacedLink.documentIndex)[0]!.path,
          offset: "Paragraph with ref, ".length,
        },
        focus: {
          path: indexedTextEntries(replacedLink.documentIndex)[0]!.path,
          offset: "Paragraph with ref, code".length,
        },
      },
      "snippet",
    )!;

    expect(serializeDocument(replacedCode.documentIndex.document)).toBe(
      "Paragraph with [ref](https://example.com), `snippet`, and ![alt](https://example.com/image.png).\n",
    );
  });

  test("reuses untouched indexed roots and blocks for same-length single-root edits", () => {
    const runtime = createDocumentIndex(
      parseDocument(`# Heading

alpha

beta
`),
    );
    const paragraph = indexedTextEntries(runtime)[1];

    if (!paragraph) {
      throw new Error("Expected editable paragraph container");
    }

    const replaced = spliceText(
      runtime,
      {
        anchor: {
          path: paragraph.path,
          offset: 0,
        },
        focus: {
          path: paragraph.path,
          offset: paragraph.text.length,
        },
      },
      "omega",
    )!;

    expect(replaced.documentIndex.blocks[0]).toBe(runtime.blocks[0]);
    expect(replaced.documentIndex.blocks[1]).not.toBe(runtime.blocks[1]);
    expect(replaced.documentIndex.blocks[2]).toBe(runtime.blocks[2]);
    expect(resolveEditorTextAtPath(replaced.documentIndex, paragraph.path)).toBe("omega");
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
    const paragraph = indexedTextEntries(runtime)[1];

    if (!paragraph) {
      throw new Error("Expected editable paragraph container");
    }

    const replaced = spliceText(
      runtime,
      {
        anchor: {
          path: paragraph.path,
          offset: 0,
        },
        focus: {
          path: paragraph.path,
          offset: paragraph.text.length,
        },
      },
      "alphabet",
    )!;

    expect(replaced.documentIndex.roots[2]).toBe(runtime.roots[2]);
    expect(resolveEditorTextAtPath(replaced.documentIndex, "root.2")).toBe("beta");
  });

  test("replaces a selected image atomically instead of editing its alt text", () => {
    const runtime = createDocumentIndex(
      parseDocument("before ![alt](https://example.com/image.png) after\n"),
    );
    const paragraph = indexedTextEntries(runtime)[0];

    if (!paragraph) {
      throw new Error("Expected paragraph container");
    }

    const imageInline = (paragraph.inlines ?? []).find((inline) => inline.node.type === "image");

    if (!imageInline) {
      throw new Error("Expected image inline");
    }

    const replaced = spliceText(
      runtime,
      {
        anchor: {
          path: paragraph.path,
          offset: imageInline.start,
        },
        focus: {
          path: paragraph.path,
          offset: imageInline.end,
        },
      },
      "media",
    )!;

    expect(serializeDocument(replaced.documentIndex.document)).toBe("before media after\n");
  });
});

function findEditorPathByText(documentIndex: DocumentIndex, text: string) {
  for (const indexedBlock of documentIndex.blocks) {
    if (
      (indexedBlock.kind === "inlines" || indexedBlock.kind === "source") &&
      indexedBlock.text === text
    ) {
      return indexedBlock.path;
    }

    if (indexedBlock.kind === "cells") {
      for (const row of indexedBlock.tableCellRows) {
        for (const cell of row) {
          if (cell.text === text) {
            return cell.path;
          }
        }
      }
    }
  }

  return null;
}
