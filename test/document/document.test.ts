import { describe, expect, test } from "bun:test";
import {
  captureTextAnchor,
  createCommentThread,
  createDocument,
  spliceCommentThreads,
  spliceDocument,
  createBlockquoteBlock,
  createLineBreak,
  createCodeBlock,
  createImage,
  createLink,
  createListBlock,
  createListItemBlock,
  createMention,
  createParagraphBlock,
  createParagraphTextBlock,
  createResource,
  createTableBlock,
  createTableCell,
  createTableRow,
  createText,
  createDividerBlock,
  createRawBlock,
  createRaw,
  extractPlainTextFromBlockNodes,
  extractPlainTextFromInlineNodes,
  isReferenceInlineNode,
  listAnchorContainers,
  type Block,
  type Inline,
} from "@/document";
import { createSampleBlocks, createTestDocument, expectAnchorContainerAt } from "./helpers";

describe("Document construction", () => {
  test("canonicalizes text mark order and duplicates", () => {
    const text = createText("marked", ["superscript", "underline", "bold", "underline"]);

    expect(text.marks).toEqual(["bold", "underline", "superscript"]);
  });

  test("deduplicates generated comment thread ids within a document", () => {
    const block = createParagraphTextBlock("Review this paragraph");
    const container = expectAnchorContainerAt(createDocument([block]), 0);
    const thread = createCommentThread({
      anchor: captureTextAnchor(container, 0, "Review".length).anchor,
      body: "Looks good.",
      createdAt: "2026-04-05T12:00:00.000Z",
      quote: "Review",
    });
    const threads = [
      { ...thread, id: "" },
      { ...thread, id: "" },
      { ...thread, id: "" },
    ];

    const document = createDocument([block], threads);
    const reloaded = createDocument([block], threads);
    const ids = document.comments.map((comment) => comment.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(thread.id);
    expect(ids[0]).toMatch(/^commentThread-/);
    expect(ids[1]).not.toBe(thread.id);
    expect(ids[2]).not.toBe(thread.id);
    expect(reloaded.comments.map((comment) => comment.id)).toEqual(ids);
  });

  test("canonicalizes resource protocols from urls and explicit protocol fallbacks", () => {
    expect(
      createResource({
        label: "Recording session",
        protocol: "ignored:",
        url: "Demo-Resource://recording/live",
      }).protocol,
    ).toBe("demo-resource:");
    expect(
      createResource({
        label: "Recording session",
        protocol: "Demo-Resource",
        url: "recording/live",
      }).protocol,
    ).toBe("demo-resource:");
    expect(
      createResource({
        label: "Recording session",
        protocol: "not a protocol",
        url: "recording/live",
      }).protocol,
    ).toBe("");
  });
});

describe("Document splicing", () => {
  test("splices one root without renormalizing unaffected siblings", () => {
    const metadata = new Map([["title", "Sample"]]);
    const document = createDocument(createSampleBlocks(), [], metadata);
    const leadingBlock = document.blocks[0];
    const trailingBlock = document.blocks[1];
    const nextDocument = spliceDocument(document, 1, 1, [createParagraphTextBlock("beta")]);

    expect(nextDocument.blocks[0]).toBe(leadingBlock);
    expect(nextDocument.blocks[1]?.plainText).toBe("beta");
    expect(nextDocument.blocks[1]).not.toBe(trailingBlock);
    expect(nextDocument.comments).toBe(document.comments);
    expect(nextDocument.metadata).toBe(metadata);
  });

  test("splices comment threads and seals their ids without rebuilding semantic blocks", () => {
    const document = createTestDocument(createSampleBlocks());
    const metadata = new Map([["title", "Sample"]]);
    const container = listAnchorContainers(document)[0];

    if (!container) {
      throw new Error("Expected comment container");
    }

    const firstThread = createCommentThread({
      ...captureTextAnchor(container, 0, 5),
      body: "First",
      createdAt: "2026-04-11T12:00:00.000Z",
    });
    const secondThread = createCommentThread({
      ...captureTextAnchor(container, 6, 10),
      body: "Second",
      createdAt: "2026-04-11T12:01:00.000Z",
    });
    const nextDocument = spliceCommentThreads(
      {
        ...document,
        comments: [firstThread],
        metadata,
      },
      0,
      1,
      [{ ...secondThread, id: "" }],
    );

    expect(nextDocument.blocks[0]).toBe(document.blocks[0]);
    expect(nextDocument.comments).toEqual([secondThread]);
    expect(nextDocument.metadata).toBe(metadata);
  });
});

describe("Plain text extraction", () => {
  test("extracts plain text from semantic inline nodes", () => {
    const nodes: Inline[] = [
      createText("Plain "),
      createLink({
        children: [
          createText("link"),
          createLineBreak(),
          createImage({ alt: "preview", url: "https://example.com/preview.png" }),
        ],
        url: "https://example.com",
      }),
      createText("code", ["code"]),
      createImage({ alt: "alt text", url: "https://example.com/image.png" }),
      createMention({ name: "Jane Doe", userId: "user-123" }),
      createResource({
        label: "Recording session",
        protocol: "demo-resource:",
        url: "demo-resource://recording/live",
      }),
      createRaw({
        originalType: "textDirective",
        source: ":badge[raw]{disabled}",
      }),
    ];

    expect(extractPlainTextFromInlineNodes(nodes)).toBe(
      "Plain link\npreviewcodealt text@Jane DoeRecording session:badge[raw]{disabled}",
    );
  });

  test("classifies external-reference inlines through the semantic umbrella", () => {
    const image = createImage({ alt: "Preview", url: "https://example.com/image.png" });
    const mention = createMention({ name: "Jane Doe", userId: "user-123" });
    const resource = createResource({
      label: "Recording session",
      protocol: "demo-resource:",
      url: "demo-resource://recording/live",
    });
    const text = createText("plain");

    expect([image, mention, resource].every(isReferenceInlineNode)).toBe(true);
    expect(isReferenceInlineNode(text)).toBe(false);
  });

  test("extracts plain text from semantic block trees", () => {
    const blocks: Block[] = [
      createParagraphTextBlock("Lead"),
      createListBlock({
        items: [
          createListItemBlock({
            children: [createParagraphTextBlock("alpha")],
          }),
          createListItemBlock({
            children: [createParagraphTextBlock("beta")],
          }),
        ],
        ordered: false,
      }),
      createTableBlock({
        rows: [
          createTableRow([
            createTableCell([createText("left")]),
            createTableCell([createText("right")]),
          ]),
          createTableRow([
            createTableCell([createText("one")]),
            createTableCell([createText("two")]),
          ]),
        ],
      }),
      createBlockquoteBlock([createParagraphTextBlock("Quote")]),
      createListItemBlock({
        children: [
          createParagraphBlock([
            createText("Nested "),
            createRaw({
              originalType: "textDirective",
              source: ':badge[body]{tone="info"}',
            }),
          ]),
        ],
      }),
      createCodeBlock({ source: "const stage = 1;" }),
      createRawBlock({
        originalType: "containerDirective",
        source: ':::callout{tone="note"}\nBody\n:::',
      }),
    ];

    expect(extractPlainTextFromBlockNodes(blocks)).toBe(
      'Lead\nalpha\nbeta\nleft | right\none | two\nQuote\nNested :badge[body]{tone="info"}\nconst stage = 1;\n:::callout{tone="note"}\nBody\n:::',
    );
    expect(extractPlainTextFromBlockNodes([createDividerBlock()])).toBe("");
  });
});
