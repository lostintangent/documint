import { describe, expect, test } from "bun:test";
import { updateLink, removeLink } from "@/editor/state";
import { setup, getPath, placeAt, toMarkdown } from "../../helpers";

describe("Link commands", () => {
  test("updates the url of an existing link", () => {
    const state = setup("See [docs](https://old.example.com) here.\n");
    const path = getPath(state, "See docs here.");
    const linkStart = path.text.indexOf("docs");
    const next = updateLink(
      state,
      { path: path.path, startOffset: linkStart, endOffset: linkStart + 4 },
      "https://new.example.com",
    );

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("See [docs](https://new.example.com) here.\n");
  });

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
});
