import { describe, expect, test } from "bun:test";
import { resolveMentionLineChange } from "@/component/sync";
import { createEditorStateTransition } from "@/component/store/editor/transitions";
import { insertMention } from "@/editor/state";
import { getPath, setup } from "@test/editor/helpers";

describe("resolveMentionLineChange", () => {
  test.each([
    ["Hello @Ja\n", "Hello @Ja", "Hello @[Jane](u-jane) ", 1],
    ["@Ja\n", "@Ja", "@[Jane](u-jane) ", 1],
    ["First paragraph\n\nSecond @Ja\n", "Second @Ja", "Second @[Jane](u-jane) ", 3],
    ["First\nparagraph\n\nSecond @Ja\n", "Second @Ja", "Second @[Jane](u-jane) ", 4],
    ["> Intro\n> @Ja\n", "Intro\n@Ja", "> @[Jane](u-jane) ", 2],
    ["| A | B |\n| - | - |\n| @Ja | two |\n", "@Ja", "| @[Jane](u-jane)  | two |", 3],
    ["---\ntitle: Test\n---\n\nHello @Ja\n", "Hello @Ja", "Hello @[Jane](u-jane) ", 5],
    ["---\ntitle: Test\n# kept\n---\n\nHello @Ja\n", "Hello @Ja", "Hello @[Jane](u-jane) ", 6],
  ])("reports the mention's saved line in %j", (markdown, text, lineMarkdown, lineNumber) => {
    expect(resolveMentionLineChange(createMentionTransition(markdown, text))).toEqual({
      lineMarkdown,
      lineNumber,
    });
  });
});

function createMentionTransition(markdown: string, text: string) {
  const previous = setup(markdown);
  const path = getPath(previous, text);
  const startOffset = path.text.indexOf("@Ja");
  const target = { endOffset: startOffset + "@Ja".length, path: path.path, startOffset };
  const next = insertMention(previous, target, "u-jane", "Jane", " ");

  if (!next) {
    throw new Error("Expected mention replacement to produce a state");
  }

  return createEditorStateTransition(previous, next, "local", []);
}
