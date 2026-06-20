import { parseDocument } from "@/markdown";
import type { BenchmarkBudgetTree } from "./harness";

export type BenchmarkManifest = {
  benchmarks: BenchmarkBudgetTree;
  fixtures: Array<{ id: string; path: string }>;
};

export type BenchmarkFixtures = Awaited<ReturnType<typeof createBenchmarkFixtures>>;

export async function createBenchmarkFixtures(manifest: BenchmarkManifest) {
  const sampleMarkdown = await readBenchmarkFixtureMarkdown(manifest, "sample");
  const mediumMarkdown = await readBenchmarkFixtureMarkdown(manifest, "full-spectrum");
  const nestedStructuralMarkdown = await readBenchmarkFixtureMarkdown(
    manifest,
    "nested-structural",
  );
  const blockquoteTransitionMarkdown = await readBenchmarkFixtureMarkdown(
    manifest,
    "blockquote-transitions",
  );
  const richCodeMarkdown = await readBenchmarkFixtureMarkdown(manifest, "rich-code");
  const richMixedMarkdown = await readBenchmarkFixtureMarkdown(manifest, "rich-mixed");
  const richTablesMarkdown = await readBenchmarkFixtureMarkdown(manifest, "rich-tables");
  const commentsMarkdown = await readBenchmarkFixtureMarkdown(manifest, "comments-review");
  const longMarkdown = buildSyntheticLongFixture(mediumMarkdown, 90);
  const xlargeMarkdown = buildSyntheticLongFixture(mediumMarkdown, 180);
  const hugeMarkdown = buildSyntheticLongFixture(mediumMarkdown, 360);

  return {
    blockquoteTransitionSnapshot: parseDocument(blockquoteTransitionMarkdown),
    commentsMarkdown,
    commentsSnapshot: parseDocument(commentsMarkdown),
    hugeMarkdown,
    hugeSnapshot: parseDocument(hugeMarkdown),
    longMarkdown,
    longSnapshot: parseDocument(longMarkdown),
    mediumMarkdown,
    mediumSnapshot: parseDocument(mediumMarkdown),
    nestedStructuralSnapshot: parseDocument(nestedStructuralMarkdown),
    richCodeSnapshot: parseDocument(richCodeMarkdown),
    richMixedMarkdown,
    richMixedSnapshot: parseDocument(richMixedMarkdown),
    richTablesSnapshot: parseDocument(richTablesMarkdown),
    sampleMarkdown,
    sampleSnapshot: parseDocument(sampleMarkdown),
    xlargeMarkdown,
    xlargeSnapshot: parseDocument(xlargeMarkdown),
  };
}

async function readBenchmarkFixtureMarkdown(manifest: BenchmarkManifest, id: string) {
  const fixture = manifest.fixtures.find((candidate) => candidate.id === id);

  if (!fixture) {
    throw new Error(`Unknown fixture: ${id}`);
  }

  return Bun.file(fixture.path).text();
}

function buildSyntheticLongFixture(seed: string, repetitions: number) {
  return Array.from({ length: repetitions }, () => seed.trimEnd()).join("\n\n") + "\n";
}
