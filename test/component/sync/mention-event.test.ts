import { describe, expect, test } from "bun:test";
import { resolveMentionLineChange } from "@/component/sync";
import { createEditorStateTransition } from "@/component/store/editor/transitions";
import { insertMention } from "@/editor/state";
import type { TextRangeTarget } from "@/editor";
import { getPath, setup } from "@test/editor/helpers";

describe("resolveMentionLineChange", () => {
  test("returns the changed canonical markdown line", () => {
    expect(
      resolveMentionLineChange(...createMentionTransition("Hello @Ja\n", "Hello @Ja")),
    ).toEqual({
      lineMarkdown: "Hello @[Jane](u-jane) ",
      lineNumber: 1,
    });
  });

  test("returns the line number for a later document line", () => {
    expect(
      resolveMentionLineChange(
        ...createMentionTransition("First paragraph\n\nSecond @Ja\n", "Second @Ja"),
      ),
    ).toEqual({
      lineMarkdown: "Second @[Jane](u-jane) ",
      lineNumber: 3,
    });
  });

  test("returns the inserted mention line when the previous line had no other content", () => {
    expect(resolveMentionLineChange(...createMentionTransition("@Ja\n", "@Ja"))).toEqual({
      lineMarkdown: "@[Jane](u-jane) ",
      lineNumber: 1,
    });
  });

  test("returns the changed line inside a nested root fragment", () => {
    expect(
      resolveMentionLineChange(...createMentionTransition("> Intro\n> @Ja\n", "Intro\n@Ja")),
    ).toEqual({
      lineMarkdown: "> @[Jane](u-jane) ",
      lineNumber: 2,
    });
  });

  test("returns the changed table row for table cell mentions", () => {
    expect(
      resolveMentionLineChange(
        ...createMentionTransition("| A | B |\n| - | - |\n| @Ja | two |\n", "@Ja"),
      ),
    ).toEqual({
      lineMarkdown: "| @[Jane](u-jane)  | two |",
      lineNumber: 3,
    });
  });

  test("accounts for front matter before document blocks", () => {
    expect(
      resolveMentionLineChange(
        ...createMentionTransition("---\ntitle: Test\n---\n\nHello @Ja\n", "Hello @Ja"),
      ),
    ).toEqual({
      lineMarkdown: "Hello @[Jane](u-jane) ",
      lineNumber: 5,
    });
  });

  test("returns null when the target no longer resolves", () => {
    const [transition, target] = createMentionTransition("Hello @Ja\n", "Hello @Ja");

    expect(
      resolveMentionLineChange(transition, {
        ...target,
        path: "missing-path",
      }),
    ).toBeNull();
  });
});

function createMentionTransition(markdown: string, text: string) {
  const previous = setup(markdown);
  const path = getPath(previous, text);
  const startOffset = path.text.indexOf("@Ja");

  if (startOffset === -1) {
    throw new Error(`Expected @Ja in path "${path.text}"`);
  }

  const target: TextRangeTarget = {
    endOffset: startOffset + "@Ja".length,
    path: path.path,
    startOffset,
  };
  const next = insertMention(previous, target, "u-jane", "Jane", " ");

  if (!next) {
    throw new Error("Expected mention replacement to produce a state");
  }

  return [createEditorStateTransition(previous, next, "local"), target] as const;
}
