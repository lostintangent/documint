import { describe, expect, test } from "bun:test";
import { resolveEditorSearchMatches, resolveRegion, type EditorSearchMatch } from "@/editor";
import { setup } from "../helpers";

describe("editor search", () => {
  test("finds case-insensitive matches in document flow", () => {
    const state = setup("Alpha target\n\nbeta TARGET\n\nomega");
    const matches = resolveEditorSearchMatches(state.documentIndex, "target");

    expect(matches.map(resolveMatchText(state))).toEqual(["target", "TARGET"]);
  });

  test("supports single-character queries", () => {
    const state = setup("banana");
    const matches = resolveEditorSearchMatches(state.documentIndex, "a");

    expect(matches.map(resolveMatchText(state))).toEqual(["a", "a", "a"]);
  });

  test("can match case-sensitive queries", () => {
    const state = setup("TODO Todo todo");

    expect(
      resolveEditorSearchMatches(state.documentIndex, "todo", { caseSensitive: true }).map(
        resolveMatchText(state),
      ),
    ).toEqual(["todo"]);
    expect(
      resolveEditorSearchMatches(state.documentIndex, "TODO", { caseSensitive: true }).map(
        resolveMatchText(state),
      ),
    ).toEqual(["TODO"]);
  });

  test("searches formatted text, links, table cells, and source regions", () => {
    const state = setup(
      "**bold target** and [link target](https://example.com)\n\n| A |\n| --- |\n| cell target |\n\n```ts\ncode target\n```",
    );
    const matches = resolveEditorSearchMatches(state.documentIndex, "target");

    expect(matches.map(resolveMatchText(state))).toEqual(["target", "target", "target", "target"]);
    expect(
      matches.map((match) => resolveRegion(state.documentIndex, match.regionPath)?.text),
    ).toEqual([
      "bold target and link target",
      "bold target and link target",
      "cell target",
      "code target",
    ]);
  });

  test("keeps offsets aligned when case folding changes string length", () => {
    const state = setup("İab");
    const matches = resolveEditorSearchMatches(state.documentIndex, "a");

    expect(matches.map(resolveMatchText(state))).toEqual(["a"]);
  });
});

function resolveMatchText(state: ReturnType<typeof setup>) {
  return (match: EditorSearchMatch) => {
    const region = resolveRegion(state.documentIndex, match.regionPath);
    return region?.text.slice(match.startOffset, match.endOffset) ?? "";
  };
}
