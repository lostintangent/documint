import { parseDocument } from "@/markdown";

export type BenchmarkFixtures = Awaited<ReturnType<typeof createBenchmarkFixtures>>;

export async function createBenchmarkFixtures() {
  const sampleMarkdown = await readGolden("sample");
  const mediumMarkdown = await readGolden("full-spectrum");
  const nestedStructuralMarkdown = await readGolden("nested-structural");
  const blockquoteTransitionMarkdown = await readGolden("blockquote-transitions");
  const richCodeMarkdown = await readGolden("rich-code");
  const richMixedMarkdown = await readGolden("rich-mixed");
  const richTablesMarkdown = await readGolden("rich-tables");
  const commentsMarkdown = await readGolden("comments-review");
  const longMarkdown = buildSyntheticLongFixture(mediumMarkdown, 90);
  const xlargeMarkdown = buildSyntheticLongFixture(mediumMarkdown, 180);
  const hugeMarkdown = buildSyntheticLongFixture(mediumMarkdown, 360);
  const denseMarkdown = buildDenseFixture(mediumMarkdown);
  const tablesLongMarkdown = buildTablesLongFixture(40);
  const paragraphsLongMarkdown = buildParagraphsLongFixture(1500);
  const metadataSnapshot = parseDocument(buildMetadataFixture(longMarkdown));

  return {
    blockquoteTransitionSnapshot: parseDocument(blockquoteTransitionMarkdown),
    commentsMarkdown,
    commentsSnapshot: parseDocument(commentsMarkdown),
    denseMarkdown,
    hugeMarkdown,
    hugeSnapshot: parseDocument(hugeMarkdown),
    longMarkdown,
    longSnapshot: parseDocument(longMarkdown),
    mediumMarkdown,
    mediumSnapshot: parseDocument(mediumMarkdown),
    metadataSnapshot,
    nestedStructuralSnapshot: parseDocument(nestedStructuralMarkdown),
    paragraphsLongSnapshot: parseDocument(paragraphsLongMarkdown),
    richCodeSnapshot: parseDocument(richCodeMarkdown),
    richMixedMarkdown,
    richMixedSnapshot: parseDocument(richMixedMarkdown),
    richTablesSnapshot: parseDocument(richTablesMarkdown),
    sampleMarkdown,
    sampleSnapshot: parseDocument(sampleMarkdown),
    tablesLongSnapshot: parseDocument(tablesLongMarkdown),
    xlargeMarkdown,
    xlargeSnapshot: parseDocument(xlargeMarkdown),
  };
}

function readGolden(name: string) {
  return Bun.file(new URL(`../../test/goldens/${name}.md`, import.meta.url)).text();
}

function buildSyntheticLongFixture(seed: string, repetitions: number) {
  return Array.from({ length: repetitions }, () => seed.trimEnd()).join("\n\n") + "\n";
}

// A few long blocks, like a README with a long code listing. It stays on the
// exact full-layout path while laying out more lines than the caret boundary
// cache holds.
function buildDenseFixture(seed: string) {
  const code = Array.from(
    { length: 500 },
    (_, index) => `const value${index} = compute(${index}, "dense fixture");`,
  ).join("\n");
  const paragraph =
    "Dense documents keep few blocks but many wrapped lines, so each paragraph wraps across many lines of the benchmark viewport. ".repeat(
      4,
    );
  const paragraphs = Array.from({ length: 60 }, (_, index) => `${paragraph}${index}`).join("\n\n");

  return `${seed.trimEnd()}\n\n\`\`\`ts\n${code}\n\`\`\`\n\n${paragraphs}\n`;
}

// A long document of sections that each pair prose with a wrapping four-column
// table. Every section's text is unique, unlike the repeated long fixtures, so
// measured heights can't be shared between sections.
function buildTablesLongFixture(sections: number) {
  return (
    Array.from({ length: sections }, (_, section) => {
      const rows = Array.from(
        { length: 3 },
        (_, row) =>
          `| Layer ${section}.${row} | wraps inline in section ${section} | ${640 + row * 160} | keeps row ${row} of section ${section} aligned across narrow hosts |`,
      );

      return [
        `## Section ${section}`,
        `Section ${section} compares how each layer behaves across narrow and wide hosts, so its table wraps.`,
        [
          "| Layer | Narrow host | Wide host | Notes |",
          "| :---- | :---- | ----: | :---- |",
          ...rows,
        ].join("\n"),
        `Section ${section} closes with a note on how the table above reflows when the host resizes.`,
      ].join("\n\n");
    }).join("\n\n") + "\n"
  );
}

// Many short paragraphs whose text is unique, so text anchors resolve to one
// paragraph instead of tying across repeated copies.
function buildParagraphsLongFixture(paragraphs: number) {
  return (
    Array.from(
      { length: paragraphs },
      (_, index) =>
        `Paragraph ${index} discusses topic ${index} with enough words to anchor a comment.`,
    ).join("\n\n") + "\n"
  );
}

function buildMetadataFixture(body: string) {
  const fields = Array.from(
    { length: 16 },
    (_, index) => `field_${index + 1}: value ${index + 1}`,
  ).join("\n");

  return `---
title: Benchmark
draft: true
description: |-
  Metadata benchmark
  exercises multiline measurement
${fields}
---
${body}`;
}
