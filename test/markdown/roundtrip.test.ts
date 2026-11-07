// Asserts that every golden fixture in `test/goldens/` round-trips through
// `serialize(parse(source))` cleanly and stays stable on a second pass.
// Fixtures authored in a non-canonical form pair with the canonical file one
// save must produce.

import { describe, test } from "bun:test";
import { expectCanonicalRoundTrip, expectStableRoundTrip } from "./helpers";

const stableFixtures: string[] = [
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
  "test/goldens/frontmatter-raw.md",
  "test/goldens/line-breaks.md",
  "test/goldens/unsupported-html.md",
];

const canonicalizingFixtures: [string, string][] = [
  ["test/goldens/readme-links.md", "test/goldens/readme-links.canonical.md"],
  ["test/goldens/readme-references.md", "test/goldens/readme-references.canonical.md"],
  ["test/goldens/comments-unanchored.md", "test/goldens/comments-unanchored.canonical.md"],
];

describe("Goldens", () => {
  test.each(stableFixtures)("round-trips canonically for %s", async (fixturePath) => {
    const source = await Bun.file(fixturePath).text();

    expectStableRoundTrip(source);
  });

  test.each(canonicalizingFixtures)("saves %s as %s", async (sourcePath, canonicalPath) => {
    const source = await Bun.file(sourcePath).text();
    const canonical = await Bun.file(canonicalPath).text();

    expectCanonicalRoundTrip(source, canonical);
  });
});
