import { expect, test } from "bun:test";
import type { Link, Mark } from "@/document";
import type { InlineEntry } from "@/editor/state";
import {
  editorInlinesToDocumentInlines,
  replaceEditorInlines,
} from "@/editor/state/reducer/inlines";

test("inserting at the start of a link run stays outside the link", () => {
  const link: Link = {
    children: [],
    id: "",
    title: null,
    type: "link",
    url: "https://example.com",
  };
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
  const link: Link = {
    children: [],
    id: "",
    title: null,
    type: "link",
    url: "https://example.com",
  };
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
    createInlines([{ kind: "raw", originalType: "directive", text: "{{name}}" }]),
    2,
    6,
    "value",
  );
  const nodes = editorInlinesToDocumentInlines(nextInlines);

  expect(nodes[0]).toMatchObject({
    originalType: "directive",
    source: "{{value}}",
    type: "raw",
  });
});

test("editing inline code runs preserves inline code semantics", () => {
  const nextInlines = replaceEditorInlines(
    createInlines([{ kind: "code", text: "body" }]),
    0,
    4,
    "snippet",
  );
  const nodes = editorInlinesToDocumentInlines(nextInlines);

  expect(nodes[0]).toMatchObject({
    code: "snippet",
    type: "code",
  });
});

type InlineInput = {
  kind: "text" | "code" | "raw";
  link?: Link | null;
  marks?: readonly Mark[];
  originalType?: string;
  text: string;
};

function createInlines(inputs: InlineInput[]): InlineEntry[] {
  let start = 0;

  return inputs.map<InlineEntry>((input, index) => {
    const end = start + input.text.length;
    const node: InlineEntry["node"] =
      input.kind === "text"
        ? { id: `run:${index}`, marks: [...(input.marks ?? [])], text: input.text, type: "text" }
        : input.kind === "code"
          ? { code: input.text, id: `run:${index}`, type: "code" }
          : {
              id: `run:${index}`,
              originalType: input.originalType ?? "raw",
              source: input.text,
              type: "raw",
            };
    const inline: InlineEntry = {
      end,
      link: input.link ?? null,
      node,
      start,
      text: input.text,
    };
    start = end;

    return inline;
  });
}
