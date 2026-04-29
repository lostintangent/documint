import { expect, test } from "bun:test";
import type { EditorInline, RuntimeLinkAttributes } from "@/editor/state";
import {
  editorInlinesToDocumentInlines,
  replaceEditorInlines,
} from "@/editor/state/reducer/inlines";

test("inserting at the start of a link run stays outside the link", () => {
  const link = { title: null, url: "https://example.com" } satisfies RuntimeLinkAttributes;
  const nextInlines = replaceEditorInlines(
    createInlines([{ kind: "text", link, text: "link" }]),
    0,
    0,
    "X",
  );
  const nodes = editorInlinesToDocumentInlines(nextInlines);

  expect(nodes[0]).toMatchObject({
    text: "X",
    type: "text",
  });
  expect(nodes[1]).toMatchObject({
    type: "link",
    url: "https://example.com",
  });
  expect(nodes[1]).toHaveProperty("children.0.text", "link");
});

test("inserting between runs in the same link stays inside the link", () => {
  const link = { title: null, url: "https://example.com" } satisfies RuntimeLinkAttributes;
  const nextInlines = replaceEditorInlines(
    createInlines([
      { kind: "text", link, text: "li" },
      { kind: "text", link, text: "nk" },
    ]),
    2,
    2,
    "X",
  );
  const nodes = editorInlinesToDocumentInlines(nextInlines);

  expect(nodes).toHaveLength(1);
  expect(nodes[0]).toMatchObject({
    type: "link",
    url: "https://example.com",
  });
  expect(nodes[0]).toHaveProperty("children.0.text", "liXnk");
});

test("editing unsupported runs preserves the original unsupported type", () => {
  const nextInlines = replaceEditorInlines(
    createInlines([{ kind: "unsupported", originalType: "directive", text: "{{name}}" }]),
    2,
    6,
    "value",
  );
  const nodes = editorInlinesToDocumentInlines(nextInlines);

  expect(nodes[0]).toMatchObject({
    originalType: "directive",
    source: "{{value}}",
    type: "unsupported",
  });
});

test("editing inline code runs preserves inline code semantics", () => {
  const nextInlines = replaceEditorInlines(
    createInlines([{ kind: "inlineCode", text: "body" }]),
    0,
    4,
    "snippet",
  );
  const nodes = editorInlinesToDocumentInlines(nextInlines);

  expect(nodes[0]).toMatchObject({
    code: "snippet",
    type: "inlineCode",
  });
});

function createInlines(
  inputs: Array<{
    kind: EditorInline["kind"];
    link?: RuntimeLinkAttributes | null;
    marks?: EditorInline["marks"];
    originalType?: string | null;
    text: string;
  }>,
) {
  let start = 0;

  return inputs.map<EditorInline>((input, index) => {
    const end = start + input.text.length;
    const inline: EditorInline = {
      end,
      id: `run:${index}`,
      image: null,
      inlineCode: input.kind === "inlineCode",
      kind: input.kind,
      link: input.link ?? null,
      marks: input.marks ?? [],
      originalType: input.originalType ?? null,
      start,
      text: input.text,
    };
    start = end;

    return inline;
  });
}
