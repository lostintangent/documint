import { describe, expect, test } from "bun:test";
import { insertLink, updateLink, removeLink } from "@/editor/state";
import { setup, getPath, placeAt, selectIn, toMarkdown } from "../../helpers";

describe("Link commands", () => {
  test("removes a link while preserving its text", () => {
    const state = setup("See [docs](https://example.com) here.\n");
    const path = getPath(state, "See docs here.");
    const linkStart = path.text.indexOf("docs");
    const next = removeLink(state, {
      path: path.path,
      startOffset: linkStart,
      endOffset: linkStart + 4,
    });

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("See docs here.\n");
  });

  test("updates a link target outside the current selection", () => {
    const state = setup("See [docs](https://old.example.com) here.\n\nOther paragraph.\n");
    const linkPath = getPath(state, "See docs here.");
    const otherPath = getPath(state, "Other paragraph.");
    const linkStart = linkPath.text.indexOf("docs");
    const selectedElsewhere = placeAt(state, otherPath, "end");

    const next = updateLink(
      selectedElsewhere,
      { path: linkPath.path, startOffset: linkStart, endOffset: linkStart + 4 },
      "https://new.example.com",
    );

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe(
      "See [docs](https://new.example.com) here.\n\nOther paragraph.\n",
    );
  });

  test("wraps a selection containing a line break without dropping the break", () => {
    const state = setup("one<br>two\n");
    const path = getPath(state, "one\ntwo");
    const next = insertLink(selectIn(state, path, 1, 6), "https://example.com");

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("o[ne<br>tw](https://example.com)o\n");
  });

  test.each([
    ["an image", "See ![chart](chart.png) now\n", "See \uFFFC now"],
    ["a mention", "Hi @[Jane Doe](user-123) there\n", "Hi \uFFFC there"],
  ])("does not wrap a selection containing %s in a link", (_label, source, text) => {
    const state = setup(source);
    const path = getPath(state, text);

    expect(insertLink(selectIn(state, path, 0, text.length), "https://example.com")).toBeNull();
  });
});
