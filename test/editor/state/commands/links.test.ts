import { expect, test } from "bun:test";
import { updateLink, removeLink } from "@/editor/state";
import { setup, getRegion, toMarkdown } from "../helpers";

test("updates the url of an existing link", () => {
  const state = setup("See [docs](https://old.example.com) here.\n");
  const region = getRegion(state, "See docs here.");
  const linkStart = region.text.indexOf("docs");
  const next = updateLink(state, region.id, linkStart, linkStart + 4, "https://new.example.com");

  expect(next).not.toBeNull();
  expect(toMarkdown(next!)).toBe("See [docs](https://new.example.com) here.\n");
});

test("removes a link while preserving its text", () => {
  const state = setup("See [docs](https://example.com) here.\n");
  const region = getRegion(state, "See docs here.");
  const linkStart = region.text.indexOf("docs");
  const next = removeLink(state, region.id, linkStart, linkStart + 4);

  expect(next).not.toBeNull();
  expect(toMarkdown(next!)).toBe("See docs here.\n");
});
