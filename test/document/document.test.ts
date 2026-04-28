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
    createParagraphTextBlock({
      text: "Paragraph",
    }),
  ]);

  expect(document.comments).toEqual([]);
});

test("preserves semantic document blocks without cached source metadata", () => {
  const document = createTestDocument([
    createHeadingTextBlock({
      depth: 1,
      text: "Title",
    }),
    createParagraphTextBlock({
      text: "Paragraph",
    }),
  ]);

  expect(document.blocks.map((block) => block.type)).toEqual(["heading", "paragraph"]);
});

test("splices one root without renormalizing unaffected siblings", () => {
  const document = createTestDocument(createSampleBlocks());
  const leadingBlock = document.blocks[0];
  const trailingBlock = document.blocks[1];
  const nextDocument = spliceDocument(document, 1, 1, [
    createParagraphTextBlock({
      text: "beta",
    }),
  ]);

  expect(nextDocument.blocks[0]).toBe(leadingBlock);
  expect(nextDocument.blocks[1]?.plainText).toBe("beta");
  expect(nextDocument.blocks[1]).not.toBe(trailingBlock);
});

test("renormalizes shifted suffix roots when inserting new top-level blocks", () => {
  const document = createTestDocument(createSampleBlocks());
  const shiftedBlock = document.blocks[1];
  const nextDocument = spliceDocument(document, 1, 0, [
    createParagraphTextBlock({
      text: "inserted",
    }),
  ]);

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
    createParagraphTextBlock({
      text: "alpha",
    }),
    createParagraphTextBlock({
      text: "beta",
    }),
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
    createText({ path: "inline.0", text: "Plain " }),
    createLink({
      children: [createText({ path: "inline.1.children.0", text: "link" })],
      path: "inline.1",
      url: "https://example.com",
    }),
    createLineBreak({ path: "inline.2" }),
    createCode({ code: "code", path: "inline.3" }),
    createImage({ alt: "alt text", path: "inline.4", url: "https://example.com/image.png" }),
  ];

  expect(extractPlainTextFromInlineNodes(nodes)).toBe("Plain link\ncodealt text");
});

test("extracts plain text from links and unsupported inline nodes", () => {
  const nodes: Inline[] = [
    createText({ path: "inline.0", text: "Before " }),
    createLink({
      children: [
        createText({ path: "inline.1.children.0", text: "alpha" }),
        createLineBreak({ path: "inline.1.children.1" }),
        createImage({
          alt: "preview",
          path: "inline.1.children.2",
          url: "https://example.com/preview.png",
        }),
      ],
      path: "inline.1",
      url: "https://example.com",
    }),
    createRaw({
      originalType: "textDirective",
      path: "inline.2",
      source: ":badge[raw]{disabled}",
    }),
  ];

  expect(extractPlainTextFromInlineNodes(nodes)).toBe("Before alpha\npreview:badge[raw]{disabled}");
});

test("extracts plain text from semantic block trees", () => {
  const blocks: Block[] = [
    createParagraphTextBlock({
      text: "Lead",
    }),
    createListBlock({
      items: [
        createListItemBlock({
          children: [createParagraphTextBlock({ text: "alpha" })],
          path: "root.1.children.0",
        }),
        createListItemBlock({
          children: [createParagraphTextBlock({ text: "beta" })],
          path: "root.1.children.1",
        }),
      ],
      ordered: false,
      path: "root.1",
    }),
    createTableBlock({
      path: "root.2",
      rows: [
        createTableRow({
          cells: [
            createTableCell({
              children: [createText({ path: "root.2.rows.0.cells.0.children.0", text: "left" })],
              path: "root.2.rows.0.cells.0",
            }),
            createTableCell({
              children: [createText({ path: "root.2.rows.0.cells.1.children.0", text: "right" })],
              path: "root.2.rows.0.cells.1",
            }),
          ],
          path: "root.2.rows.0",
        }),
        createTableRow({
          cells: [
            createTableCell({
              children: [createText({ path: "root.2.rows.1.cells.0.children.0", text: "one" })],
              path: "root.2.rows.1.cells.0",
            }),
            createTableCell({
              children: [createText({ path: "root.2.rows.1.cells.1.children.0", text: "two" })],
              path: "root.2.rows.1.cells.1",
            }),
          ],
          path: "root.2.rows.1",
        }),
      ],
    }),
  ];

  expect(extractPlainTextFromBlockNodes(blocks)).toBe("Lead\nalpha\nbeta\nleft | right\none | two");
});

test("extracts plain text from nested structural blocks and empty thematic breaks", () => {
  const blocks: Block[] = [
    createBlockquoteBlock({
      children: [
        createParagraphTextBlock({
          text: "Quote",
        }),
      ],
      path: "root.0",
    }),
    createListItemBlock({
      children: [
        createParagraphBlock({
          children: [
            createText({ path: "root.1.children.0.children.0", text: "Nested " }),
            createRaw({
              originalType: "textDirective",
              path: "root.1.children.0.children.1",
              source: ':badge[body]{tone="info"}',
            }),
          ],
          path: "root.1.children.0",
        }),
      ],
      path: "root.1",
    }),
    createCodeBlock({
      path: "root.2",
      source: "const stage = 1;",
    }),
    createRawBlock({
      originalType: "containerDirective",
      path: "root.3",
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
    createParagraphTextBlock({
      text: "alpha",
    }),
  ];
}
