// Asserts that every golden fixture in `test/goldens/` round-trips through
// `serialize(parse(source))` cleanly and stays stable on a second pass.

import { describe, test } from "bun:test";
import { expectStableRoundTrip } from "./helpers";

const stableFixtures = [
  "test/goldens/sample.md",
  "test/goldens/article.md",
  "test/goldens/headings.md",
  "test/goldens/lists.md",
  "test/goldens/task-lists.md",
  "test/goldens/images-links.md",
  "test/goldens/tables.md",
  "test/goldens/blockquotes.md",
  "test/goldens/code-directives.md",
  "test/goldens/full-spectrum.md",
  "test/goldens/nested-structural.md",
  "test/goldens/blockquote-transitions.md",
  "test/goldens/long-structural.md",
  "test/goldens/rich-code.md",
  "test/goldens/rich-images.md",
  "test/goldens/rich-tables.md",
  "test/goldens/rich-mixed.md",
  "test/goldens/comments-review.md",
  "test/goldens/frontmatter.md",
  "test/goldens/line-breaks.md",
] as const;

describe("Goldens", () => {
  for (const fixturePath of stableFixtures) {
    test(`round-trips canonically for ${fixturePath}`, async () => {
      const source = await Bun.file(fixturePath).text();

      expectStableRoundTrip(source);
    });
  }
});
