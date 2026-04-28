import { expect, test } from "bun:test";
import { parseMarkdown, serializeMarkdown } from "@/markdown";

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
] as const;

for (const fixturePath of stableFixtures) {
  test(`round-trips canonically for ${fixturePath}`, async () => {
    const source = await Bun.file(fixturePath).text();
    const firstPass = serializeMarkdown(parseMarkdown(source));
    const secondPass = serializeMarkdown(parseMarkdown(firstPass));

    expect(firstPass).toBe(source);
    expect(secondPass).toBe(firstPass);
  });
}

test("round-trips underline marks through ins html", () => {
  const source = "Paragraph with <ins>underline</ins> text.\n";

  expect(serializeMarkdown(parseMarkdown(source))).toBe(source);
});

test("preserves unmatched underline html as authored markdown", () => {
  const source = "Paragraph with <ins>unfinished underline text.\n";

  expect(serializeMarkdown(parseMarkdown(source))).toBe(source);
});

test("serializes rich markdown blocks deterministically", () => {
  const source = `| Package | Width |
| :------ | ----: |
| table | responsive |

\`\`\`ts title=demo.ts
export const rich = true;
\`\`\`

See ![Preview shell](https://example.com/preview.png "Host fit").
`;

  expect(serializeMarkdown(parseMarkdown(source))).toBe(source);
});

test("round-trips comment appendices deterministically", async () => {
  const source = await Bun.file("test/goldens/comments-review.md").text();
  const snapshot = parseMarkdown(source);

  expect(snapshot.comments).toHaveLength(3);
  expect(snapshot.comments[0]?.quote).toBe("review surface");
  expect(snapshot.comments[1]?.quote).toBe("List feedback");
  expect(snapshot.comments[2]?.quote).toBe("Table cell anchors");
  expect(serializeMarkdown(snapshot)).toBe(source);
});
