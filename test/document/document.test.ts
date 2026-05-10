import { expect, test } from "bun:test";
import {
  createAnchorFromContainer,
  createCommentThread,
  extractQuoteFromContainer,
  createDocument,
  spliceCommentThreads,
  spliceDocument,
  createBlockquoteBlock,
  createLineBreak,
  createCodeBlock,
  createHeadingTextBlock,
  createImage,
  createCode,
  createLink,
  createListBlock,
  createListItemBlock,
  createParagraphBlock,
  createParagraphTextBlock,
  createTableBlock,
  createTableCell,
  createTableRow,
  createText,
  createDividerBlock,
  createRawBlock,
  createRaw,
  extractPlainTextFromBlockNodes,
  extractPlainTextFromInlineNodes,
  listAnchorContainers,
  type Block,
  type Inline,
} from "@/document";

test("builds stable semantic document identities from the same semantic content", () => {
  const first = createTestDocument(createSampleBlocks());
  const second = createTestDocument(createSampleBlocks());

  expect(first.blocks.map((block) => block.id)).toEqual(second.blocks.map((block) => block.id));
});

test("defaults document comment metadata", () => {
  const document = createTestDocument([
    createHeadingTextBlock({
      depth: 1,
      text: "Title",
    }),
    createParagraphTextBlock("Paragraph"),
  ]);

  expect(document.comments).toEqual([]);
});

test("preserves semantic document blocks without cached source metadata", () => {
  const document = createTestDocument([
    createHeadingTextBlock({
      depth: 1,
      text: "Title",
    }),
    createParagraphTextBlock("Paragraph"),
  ]);

  expect(document.blocks.map((block) => block.type)).toEqual(["heading", "paragraph"]);
});

test("splices one root without renormalizing unaffected siblings", () => {
  const document = createTestDocument(createSampleBlocks());
  const leadingBlock = document.blocks[0];
  const trailingBlock = document.blocks[1];
  const nextDocument = spliceDocument(document, 1, 1, [createParagraphTextBlock("beta")]);

  expect(nextDocument.blocks[0]).toBe(leadingBlock);
  expect(nextDocument.blocks[1]?.plainText).toBe("beta");
  expect(nextDocument.blocks[1]).not.toBe(trailingBlock);
});

test("renormalizes shifted suffix roots when inserting new top-level blocks", () => {
  const document = createTestDocument(createSampleBlocks());
  const shiftedBlock = document.blocks[1];
  const nextDocument = spliceDocument(document, 1, 0, [createParagraphTextBlock("inserted")]);

  expect(nextDocument.blocks[0]).toBe(document.blocks[0]);
  expect(nextDocument.blocks[1]?.plainText).toBe("inserted");
  expect(nextDocument.blocks[2]?.plainText).toBe("alpha");
  expect(nextDocument.blocks[2]).not.toBe(shiftedBlock);
  expect(nextDocument.blocks[2]?.id).not.toBe(shiftedBlock?.id);
});

test("renormalizes shifted suffix roots when removing top-level blocks", () => {
  const document = createTestDocument([
    createHeadingTextBlock({
      depth: 1,
      text: "Sample",
    }),
    createParagraphTextBlock("alpha"),
    createParagraphTextBlock("beta"),
  ]);
  const shiftedBlock = document.blocks[2];
  const nextDocument = spliceDocument(document, 1, 1, []);

  expect(nextDocument.blocks).toHaveLength(2);
  expect(nextDocument.blocks[0]).toBe(document.blocks[0]);
  expect(nextDocument.blocks[1]?.plainText).toBe("beta");
  expect(nextDocument.blocks[1]).not.toBe(shiftedBlock);
  expect(nextDocument.blocks[1]?.id).not.toBe(shiftedBlock?.id);
});

test("splices comment threads without rebuilding semantic blocks", () => {
  const document = createTestDocument(createSampleBlocks());
  const container = listAnchorContainers(document)[0];

  if (!container) {
    throw new Error("Expected comment container");
  }

  const firstThread = createCommentThread({
    anchor: createAnchorFromContainer(container, 0, 5),
    body: "First",
    createdAt: "2026-04-11T12:00:00.000Z",
    quote: extractQuoteFromContainer(container, 0, 5),
  });
  const secondThread = createCommentThread({
    anchor: createAnchorFromContainer(container, 6, 10),
    body: "Second",
    createdAt: "2026-04-11T12:01:00.000Z",
    quote: extractQuoteFromContainer(container, 6, 10),
  });
  const nextDocument = spliceCommentThreads(
    {
      ...document,
      comments: [firstThread],
    },
    0,
    1,
    [secondThread],
  );

  expect(nextDocument.blocks[0]).toBe(document.blocks[0]);
  expect(nextDocument.comments).toEqual([secondThread]);
});

test("extracts plain text from semantic inline nodes", () => {
  const nodes: Inline[] = [
    createText("Plain "),
    createLink({
      children: [createText("link")],
      url: "https://example.com",
    }),
    createLineBreak(),
    createCode("code"),
    createImage({ alt: "alt text", url: "https://example.com/image.png" }),
  ];

  expect(extractPlainTextFromInlineNodes(nodes)).toBe("Plain link\ncodealt text");
});

test("extracts plain text from links and unsupported inline nodes", () => {
  const nodes: Inline[] = [
    createText("Before "),
    createLink({
      children: [
        createText("alpha"),
        createLineBreak(),
        createImage({
          alt: "preview",
          url: "https://example.com/preview.png",
        }),
      ],
      url: "https://example.com",
    }),
    createRaw({
      originalType: "textDirective",
      source: ":badge[raw]{disabled}",
    }),
  ];

  expect(extractPlainTextFromInlineNodes(nodes)).toBe("Before alpha\npreview:badge[raw]{disabled}");
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
  ];

  expect(extractPlainTextFromBlockNodes(blocks)).toBe("Lead\nalpha\nbeta\nleft | right\none | two");
});

test("extracts plain text from nested structural blocks and empty thematic breaks", () => {
  const blocks: Block[] = [
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
    'Quote\nNested :badge[body]{tone="info"}\nconst stage = 1;\n:::callout{tone="note"}\nBody\n:::',
  );
  expect(extractPlainTextFromBlockNodes([createDividerBlock()])).toBe("");
});

function createTestDocument(blocks: Block[]) {
  return createDocument(blocks);
}

function createSampleBlocks(): Block[] {
  return [
    createHeadingTextBlock({
      depth: 1,
      text: "Sample",
    }),
    createParagraphTextBlock("alpha"),
  ];
}
