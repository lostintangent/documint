import { buildSyntheticLongFixture, readBenchmarkFixtureMarkdown } from "@test/utils";
import { parseMarkdown } from "@/markdown";
import { createEditorBenchmarks } from "./editor";
import { createLayoutBenchmarks } from "./layout";
import { createMarkdownBenchmarks } from "./markdown";
import type { BenchmarkBudgetTree } from "./shared";

const manifestPath = new URL("./manifest.json", import.meta.url);
const manifest = (await Bun.file(manifestPath).json()) as {
  benchmarks: BenchmarkBudgetTree;
};

const sampleMarkdown = await readBenchmarkFixtureMarkdown("sample");
const mediumMarkdown = await readBenchmarkFixtureMarkdown("full-spectrum");
const nestedStructuralMarkdown = await readBenchmarkFixtureMarkdown("nested-structural");
const blockquoteTransitionMarkdown = await readBenchmarkFixtureMarkdown("blockquote-transitions");
const richCodeMarkdown = await readBenchmarkFixtureMarkdown("rich-code");
const richMixedMarkdown = await readBenchmarkFixtureMarkdown("rich-mixed");
const richTablesMarkdown = await readBenchmarkFixtureMarkdown("rich-tables");
const commentsMarkdown = await readBenchmarkFixtureMarkdown("comments-review");
const longMarkdown = buildSyntheticLongFixture(mediumMarkdown, 90);
const xlargeMarkdown = buildSyntheticLongFixture(mediumMarkdown, 180);
const hugeMarkdown = buildSyntheticLongFixture(mediumMarkdown, 360);

const sampleSnapshot = parseMarkdown(sampleMarkdown);
const mediumSnapshot = parseMarkdown(mediumMarkdown);
const nestedStructuralSnapshot = parseMarkdown(nestedStructuralMarkdown);
const blockquoteTransitionSnapshot = parseMarkdown(blockquoteTransitionMarkdown);
const richCodeSnapshot = parseMarkdown(richCodeMarkdown);
const richMixedSnapshot = parseMarkdown(richMixedMarkdown);
const richTablesSnapshot = parseMarkdown(richTablesMarkdown);
const commentsSnapshot = parseMarkdown(commentsMarkdown);
const longSnapshot = parseMarkdown(longMarkdown);
const xlargeSnapshot = parseMarkdown(xlargeMarkdown);
const hugeSnapshot = parseMarkdown(hugeMarkdown);

const benchmarks = [
  ...createMarkdownBenchmarks(manifest.benchmarks.markdown, {
    longMarkdown,
    longSnapshot,
    mediumMarkdown,
    mediumSnapshot,
    commentsMarkdown,
    commentsSnapshot,
    richMixedMarkdown,
    richMixedSnapshot,
    sampleMarkdown,
    sampleSnapshot,
  }),
  ...createLayoutBenchmarks(manifest.benchmarks.layout, {
    hugeMarkdown,
    longMarkdown,
    mediumMarkdown,
    xlargeMarkdown,
  }),
  ...createEditorBenchmarks(manifest.benchmarks.editor, {
    blockquoteTransitionSnapshot,
    hugeSnapshot,
    longSnapshot,
    mediumSnapshot,
    nestedStructuralSnapshot,
    commentsSnapshot,
    richCodeSnapshot,
    richTablesSnapshot,
    sampleSnapshot,
    xlargeSnapshot,
  }),
];

const failures = benchmarks.filter((benchmark) => {
  if (benchmark.budgetMs === undefined) {
    return false;
  }

  return benchmark.p95Ms > benchmark.budgetMs;
});

console.table(benchmarks);

if (failures.length > 0) {
  const lines = failures.map(
    (failure) =>
      `${failure.name} exceeded budget: p95=${failure.p95Ms.toFixed(3)}ms budget=${failure.budgetMs?.toFixed(3)}ms`,
  );

  throw new Error(lines.join("\n"));
}
