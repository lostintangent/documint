import { describe, expect, test } from "bun:test";
import {
  createImage,
  createLineBreak,
  createLink,
  createMention,
  createRaw,
  createResource,
  createText,
  type Inline,
} from "@/document";
import {
  editorInlineText,
  editorInlineTextLength,
  inlineNodesWithEditorRanges,
} from "@/editor/text/inline-offsets";

describe("editor inline offsets", () => {
  test("maps inline nodes to editor-coordinate text and ranges", () => {
    const image = createImage({ alt: "Preview", url: "https://example.com/image.png" });
    const mention = createMention({ name: "Jane Doe", userId: "user-123" });
    const resource = createResource({
      label: "Recording session",
      protocol: "demo-resource:",
      url: "demo-resource://recording/live",
    });
    const raw = createRaw({ originalType: "html", source: "<x>" });
    const link = createLink({
      children: [createText("go"), createMention({ name: "Ada", userId: "user-ada" })],
      url: "https://example.com",
    });
    const nodes: Inline[] = [
      createText("a"),
      createText("b", ["bold"]),
      createLineBreak(),
      image,
      mention,
      resource,
      raw,
      link,
      createText(" tail"),
    ];

    expect([image, mention, resource].map(editorInlineText)).toEqual([
      "\uFFFC",
      "\uFFFC",
      "\uFFFC",
    ]);
    expect(editorInlineText(createLineBreak())).toBe("\n");
    expect(editorInlineText(raw)).toBe("<x>");
    expect(editorInlineTextLength(link)).toBe(3);
    expect(editorInlineTextLength(nodes[0]!)).toBe(1);

    expect(
      [...inlineNodesWithEditorRanges(nodes)].map(({ node, start, end }) => [
        node.type,
        start,
        end,
      ]),
    ).toEqual([
      ["text", 0, 1],
      ["text", 1, 2],
      ["lineBreak", 2, 3],
      ["image", 3, 4],
      ["mention", 4, 5],
      ["resource", 5, 6],
      ["raw", 6, 9],
      ["link", 9, 12],
      ["text", 12, 17],
    ]);

    const unmarkedTextRuns = [...inlineNodesWithEditorRanges(nodes)].flatMap(
      ({ node, start, end }) =>
        node.type === "text" && node.marks.length === 0 ? [{ end, start, text: node.text }] : [],
    );

    expect(unmarkedTextRuns).toEqual([
      { end: 1, start: 0, text: "a" },
      { end: 17, start: 12, text: " tail" },
    ]);
  });
});
