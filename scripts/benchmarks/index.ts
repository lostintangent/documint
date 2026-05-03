import { buildSyntheticLongFixture, readBenchmarkFixtureMarkdown } from "@test/utils";
import { parseDocument } from "@/markdown";
import { createComponentBenchmarks } from "./component";
import { createEditorBenchmarks } from "./editor";
import { createLayoutBenchmarks } from "./layout";
import { createMarkdownBenchmarks } from "./markdown";
import type { BenchmarkBudgetTree, BenchmarkRecord } from "./shared";

type RepeatedBudgetFailure = {
  budgetMs: number;
  failureCount: number;
  name: string;
  records: BenchmarkRecord[];
};

const manifestPath = new URL("./manifest.json", import.meta.url);
const manifest = (await Bun.file(manifestPath).json()) as {
  benchmarks: BenchmarkBudgetTree;
};
const benchmarkRunCount = 3;
const allowedBudgetFailureCount = 1;

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

const sampleSnapshot = parseDocument(sampleMarkdown);
const mediumSnapshot = parseDocument(mediumMarkdown);
const nestedStructuralSnapshot = parseDocument(nestedStructuralMarkdown);
const blockquoteTransitionSnapshot = parseDocument(blockquoteTransitionMarkdown);
const richCodeSnapshot = parseDocument(richCodeMarkdown);
const richMixedSnapshot = parseDocument(richMixedMarkdown);
const richTablesSnapshot = parseDocument(richTablesMarkdown);
const commentsSnapshot = parseDocument(commentsMarkdown);
const longSnapshot = parseDocument(longMarkdown);
const xlargeSnapshot = parseDocument(xlargeMarkdown);
const hugeSnapshot = parseDocument(hugeMarkdown);

const benchmarkRuns = runBenchmarkSuite();

const failures = collectRepeatedBudgetFailures(benchmarkRuns);

if (failures.length > 0) {
  throw new Error(formatBudgetFailureMessage(failures));
}

function runBenchmarkSuite() {
  return Array.from({ length: benchmarkRunCount }, (_, index) => {
    const records = createBenchmarks();

    console.log(`Benchmark run ${index + 1}/${benchmarkRunCount}`);
    console.table(records);

    return records;
  });
}

function createBenchmarks() {
  return [
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
    ...createComponentBenchmarks(manifest.benchmarks.component),
    ...createEditorBenchmarks(manifest.benchmarks.editor, {
      blockquoteTransitionSnapshot,
      hugeSnapshot,
      longSnapshot,
      mediumMarkdown,
      mediumSnapshot,
      nestedStructuralSnapshot,
      commentsSnapshot,
      richCodeSnapshot,
      richTablesSnapshot,
      sampleSnapshot,
      xlargeSnapshot,
    }),
  ];
}

function collectRepeatedBudgetFailures(runs: BenchmarkRecord[][]): RepeatedBudgetFailure[] {
  const recordsByName = groupBenchmarkRecordsByName(runs);

  return [...recordsByName.entries()].flatMap(([name, records]) => {
    const budgetMs = resolveBenchmarkBudget(records);

    if (budgetMs === undefined) {
      return [];
    }

    const failureCount = records.filter((record) => record.p99Ms > budgetMs).length;

    return failureCount > allowedBudgetFailureCount
      ? [
          {
            budgetMs,
            failureCount,
            name,
            records,
          },
        ]
      : [];
  });
}

function groupBenchmarkRecordsByName(runs: BenchmarkRecord[][]) {
  const recordsByName = new Map<string, BenchmarkRecord[]>();

  for (const run of runs) {
    for (const record of run) {
      const records = recordsByName.get(record.name) ?? [];

      records.push(record);
      recordsByName.set(record.name, records);
    }
  }

  return recordsByName;
}

function resolveBenchmarkBudget(records: BenchmarkRecord[]) {
  return records.find((record) => record.budgetMs !== undefined)?.budgetMs;
}

function formatBudgetFailureMessage(failures: RepeatedBudgetFailure[]) {
  return failures
    .map((failure) => {
      const p99Values = failure.records.map((record) => record.p99Ms.toFixed(3)).join(", ");

      return `${failure.name} exceeded budget in ${failure.failureCount}/${benchmarkRunCount} runs: p99=[${p99Values}] budget=${failure.budgetMs.toFixed(3)}ms`;
    })
    .join("\n");
}
