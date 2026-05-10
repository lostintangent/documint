import { expect, test } from "bun:test";
import { updateLink, removeLink } from "@/editor/state";
import { setup, getRegion, placeAt, toMarkdown } from "../../helpers";

test("updates the url of an existing link", () => {
  const state = setup("See [docs](https://old.example.com) here.\n");
  const region = getRegion(state, "See docs here.");
  const linkStart = region.text.indexOf("docs");
  const next = updateLink(
    state,
    { regionId: region.id, startOffset: linkStart, endOffset: linkStart + 4 },
    "https://new.example.com",
  );

  expect(next).not.toBeNull();
  expect(toMarkdown(next!)).toBe("See [docs](https://new.example.com) here.\n");
});

test("removes a link while preserving its text", () => {
  const state = setup("See [docs](https://example.com) here.\n");
  const region = getRegion(state, "See docs here.");
  const linkStart = region.text.indexOf("docs");
  const next = removeLink(state, {
    regionId: region.id,
    startOffset: linkStart,
    endOffset: linkStart + 4,
  });

  expect(next).not.toBeNull();
  expect(toMarkdown(next!)).toBe("See docs here.\n");
});

test("updates a link target outside the current selection", () => {
  const state = setup("See [docs](https://old.example.com) here.\n\nOther paragraph.\n");
  const linkRegion = getRegion(state, "See docs here.");
  const otherRegion = getRegion(state, "Other paragraph.");
  const linkStart = linkRegion.text.indexOf("docs");
  const selectedElsewhere = placeAt(state, otherRegion, "end");

  const next = updateLink(
    selectedElsewhere,
    { regionId: linkRegion.id, startOffset: linkStart, endOffset: linkStart + 4 },
    "https://new.example.com",
  );

  expect(next).not.toBeNull();
  expect(toMarkdown(next!)).toBe("See [docs](https://new.example.com) here.\n\nOther paragraph.\n");
});
