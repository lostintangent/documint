import { expect, test } from "bun:test";
import { insertLineBreak } from "@/editor/state";
import { createDocumentFromEditorState, createEditorState, setSelection } from "@/editor/state";
import { parseDocument, serializeDocument } from "@/markdown";

test("preserves unsupported semantic nodes during markdown export", async () => {
  const source = await Bun.file("test/goldens/unsupported-html.md").text();
  const snapshot = parseDocument(source);

  expect(serializeDocument(snapshot)).toBe(source);
});

test("preserves empty task list markers during markdown export", () => {
  const editorState = createEditorState(parseDocument("- [ ] alpha\n"));
  const container = editorState.documentIndex.regions.find((entry) => entry.text === "alpha");

  if (!container) {
    throw new Error("Expected task container");
  }

  const splitState = insertLineBreak(
    setSelection(editorState, {
      regionId: container.id,
      offset: container.text.length,
    }),
  );

  if (!splitState) {
    throw new Error("Expected structural split to succeed");
  }

  const snapshot = createDocumentFromEditorState(splitState);

  expect(serializeDocument(snapshot)).toBe("- [ ] alpha\n- [ ] \n");
});

test("normalizes authored ordered list starts to the canonical first marker by default", () => {
  const source = "3. alpha\n3. beta\n";
  const snapshot = parseDocument(source);
  const list = snapshot.blocks[0];

  if (!list || list.type !== "list") {
    throw new Error("Expected ordered list block");
  }

  expect(list.ordered).toBe(true);
  expect(list.start).toBeNull();
  expect(serializeDocument(snapshot)).toBe("1. alpha\n1. beta\n");
});

test("preserves authored ordered list starts when requested", () => {
  const source = "3. alpha\n3. beta\n";
  const snapshot = parseDocument(source, {
    preserveOrderedListStart: true,
  });
  const list = snapshot.blocks[0];

  if (!list || list.type !== "list") {
    throw new Error("Expected ordered list block");
  }

  expect(list.ordered).toBe(true);
  expect(list.start).toBe(3);
  expect(serializeDocument(snapshot)).toBe(source);
});

test("round-trips authored image widths through markdown and the semantic document", () => {
  const source = '![Preview](https://example.com/preview.png "Host fit"){width=320}\n';
  const snapshot = parseDocument(source);
  const imageBlock = snapshot.blocks[0];

  if (!imageBlock || imageBlock.type !== "paragraph") {
    throw new Error("Expected image paragraph");
  }

  const imageNode = imageBlock.children[0];

  if (!imageNode || imageNode.type !== "image") {
    throw new Error("Expected image node");
  }

  expect(imageNode.width).toBe(320);
  expect(serializeDocument(snapshot)).toBe(source);
});

test("preserves invalid authored image-width syntax as plain markdown text", () => {
  const source = "![Preview](https://example.com/preview.png){width=0}\n";

  expect(serializeDocument(parseDocument(source))).toBe(source);
});

test("emits compact table cells by default", () => {
  const source = `| Block | Status | Width | Notes |
| :---- | :----- | ----: | :---- |
| Heading | stable | 640 | stays semantic |
| Comments | anchored | 3 | remain durable |
`;

  expect(serializeDocument(parseDocument(source))).toBe(source);
});

test("pads table cells to the widest column when requested", () => {
  const source = `| Block    | Status   | Width | Notes          |
| :------- | :------- | ----: | :------------- |
| Heading  | stable   |   640 | stays semantic |
| Comments | anchored |     3 | remain durable |
`;

  expect(serializeDocument(parseDocument(source), { padTableColumns: true })).toBe(source);
});

test("drops misplaced comment appendices from document content", () => {
  const source = `:::documint-comments
[]
:::

Paragraph after misplaced appendix.
`;
  const snapshot = parseDocument(source);

  expect(snapshot.blocks).toHaveLength(1);
  expect(snapshot.blocks[0]?.type).toBe("paragraph");
  expect(snapshot.blocks[0]?.plainText).toBe("Paragraph after misplaced appendix.");
  expect(snapshot.comments).toHaveLength(0);
});

test("does not parse legacy comment appendix payload formats", () => {
  const source = `Paragraph before appendix.

:::documint-comments
\`\`\`json
{
  "threads": []
}
\`\`\`
:::
`;
  const snapshot = parseDocument(source);

  expect(snapshot.blocks).toHaveLength(1);
  expect(snapshot.comments).toHaveLength(0);
  expect(serializeDocument(snapshot)).toBe("Paragraph before appendix.\n");
});
