import { describe, expect, test } from "bun:test";
import { resolveMarkdownLineDiff } from "@/component/lib/markdown-line-diff";
import { createEditorStateTransition } from "@/component/store/editor/transitions";
import { insertMention } from "@/editor/state";
import type { TextRangeTarget } from "@/editor";
import { getRegion, setup } from "@test/editor/helpers";

describe("resolveMarkdownLineDiff", () => {
  test("returns the changed canonical markdown line", () => {
    expect(resolveMarkdownLineDiff(...createMentionTransition("Hello @Ja\n", "Hello @Ja"))).toEqual(
      {
        lineMarkdown: "Hello @[Jane](u-jane) ",
        lineNumber: 1,
      },
    );
  });

  test("returns the line number for a later document line", () => {
    expect(
      resolveMarkdownLineDiff(
        ...createMentionTransition("First paragraph\n\nSecond @Ja\n", "Second @Ja"),
      ),
    ).toEqual({
      lineMarkdown: "Second @[Jane](u-jane) ",
      lineNumber: 3,
    });
  });

  test("returns the inserted mention line when the previous line had no other content", () => {
    expect(resolveMarkdownLineDiff(...createMentionTransition("@Ja\n", "@Ja"))).toEqual({
      lineMarkdown: "@[Jane](u-jane) ",
      lineNumber: 1,
    });
  });

  test("returns the changed line inside a nested root fragment", () => {
    expect(
      resolveMarkdownLineDiff(...createMentionTransition("> Intro\n> @Ja\n", "Intro\n@Ja")),
    ).toEqual({
      lineMarkdown: "> @[Jane](u-jane) ",
      lineNumber: 2,
    });
  });

  test("returns the changed table row for table cell mentions", () => {
    expect(
      resolveMarkdownLineDiff(
        ...createMentionTransition("| A | B |\n| - | - |\n| @Ja | two |\n", "@Ja"),
      ),
    ).toEqual({
      lineMarkdown: "| @[Jane](u-jane)  | two |",
      lineNumber: 3,
    });
  });

  test("accounts for front matter before document blocks", () => {
    expect(
      resolveMarkdownLineDiff(
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
      resolveMarkdownLineDiff(transition, {
        ...target,
        regionId: "missing-region",
      }),
    ).toBeNull();
  });
});

function createMentionTransition(markdown: string, regionText: string) {
  const previous = setup(markdown);
  const region = getRegion(previous, regionText);
  const startOffset = region.text.indexOf("@Ja");

  if (startOffset === -1) {
    throw new Error(`Expected @Ja in region "${region.text}"`);
  }

  const target: TextRangeTarget = {
    endOffset: startOffset + "@Ja".length,
    regionId: region.id,
    startOffset,
  };
  const next = insertMention(previous, target, "u-jane", "Jane", " ");

  if (!next) {
    throw new Error("Expected mention replacement to produce a state");
  }

  return [createEditorStateTransition(previous, next, "local"), target] as const;
}
