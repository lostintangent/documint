export const sampleMarkdown = `# Sample Document

This is the bootstrap fixture for the editable preview editor.

- one
- two
- three
`;

export type BenchmarkFixtureId =
  | "article"
  | "blockquotes"
  | "blockquote-transitions"
  | "comments-review"
  | "code-directives"
  | "full-spectrum"
  | "headings"
  | "images-links"
  | "long-structural"
  | "lists"
  | "nested-structural"
  | "rich-code"
  | "rich-images"
  | "rich-mixed"
  | "rich-tables"
  | "sample"
  | "tables"
  | "task-lists"
  | "unsupported-html";

export async function readBenchmarkFixtureMarkdown(id: BenchmarkFixtureId) {
  const manifest = await Bun.file("scripts/benchmarks/manifest.json").json();
  const fixture = manifest.fixtures.find(
    (candidate: { id: string; path: string }) => candidate.id === id,
  );

  if (!fixture) {
    throw new Error(`Unknown fixture: ${id}`);
  }

  return Bun.file(fixture.path).text();
}

export function buildSyntheticLongFixture(seed: string, repetitions = 120) {
  return Array.from({ length: repetitions }, () => seed.trimEnd()).join("\n\n") + "\n";
}
