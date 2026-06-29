import "../../test/setup-canvas";
import { createBenchmarkFixtures, type BenchmarkManifest } from "./fixtures";
import {
  collectDuplicateBenchmarkIds,
  collectMissingBenchmarkBudgets,
  collectRepeatedBudgetFailures,
  collectUnusedBenchmarkBudgets,
  type RepeatedBudgetFailure,
} from "./gate";
import {
  formatBenchmarkJson,
  formatBenchmarkTableScenarioRuns,
} from "./output";
import { createComponentScenarios } from "./scenarios/component";
import { createEditorScenarios } from "./scenarios/editor";
import { createLayoutScenarios } from "./scenarios/layout";
import { createMarkdownScenarios } from "./scenarios/markdown";
import {
  runBenchmarkScenarios,
  type BenchmarkGroupId,
  type BenchmarkScenarioRun,
  type BenchmarkScenario,
} from "./harness";

type OutputMode = "json" | "table";

const manifestPath = new URL("./manifest.json", import.meta.url);
const manifest = (await Bun.file(manifestPath).json()) as BenchmarkManifest;
const benchmarkSuiteRunCount = 3;
const benchmarkWarmupSuiteRunCount = 1;
const allowedBudgetFailureCount = 1;
const benchmarkGroupOrder = ["markdown", "layout", "component", "editor"] as const;
const outputMode = resolveOutputMode(process.argv);
const fixtures = await createBenchmarkFixtures(manifest);

const benchmarkScenarios = createBenchmarkScenarios();
const duplicateBenchmarkIds = collectDuplicateBenchmarkIds(benchmarkScenarios);
const unusedBudgetNames = collectUnusedBenchmarkBudgets(manifest.benchmarks, benchmarkScenarios);
const missingBudgetNames = collectMissingBenchmarkBudgets(manifest.benchmarks, benchmarkScenarios);

if (duplicateBenchmarkIds.length > 0) {
  throw new Error(`Duplicate benchmark scenario ids: ${duplicateBenchmarkIds.join(", ")}`);
}

if (missingBudgetNames.length > 0) {
  throw new Error(`Missing benchmark budgets for scenario ids: ${missingBudgetNames.join(", ")}`);
}

if (unusedBudgetNames.length > 0) {
  throw new Error(`Unused benchmark budget ids: ${unusedBudgetNames.join(", ")}`);
}

runBenchmarkWarmupSuites(benchmarkScenarios);
const suiteRuns = runBenchmarkSuite();
const failures = collectRepeatedBudgetFailures(suiteRuns, allowedBudgetFailureCount);

if (outputMode === "json") {
  console.log(
    formatBenchmarkJson({
      failures,
      suiteRuns,
    }),
  );
}

if (failures.length > 0) {
  const message = formatBudgetFailureMessage(failures);

  if (outputMode === "json") {
    console.error(message);
    process.exitCode = 1;
  } else {
    throw new Error(message);
  }
}

function runBenchmarkWarmupSuites(firstRunScenarios: BenchmarkScenario[]) {
  for (let index = 0; index < benchmarkWarmupSuiteRunCount; index += 1) {
    if (outputMode === "table") {
      console.log(`Benchmark suite warmup ${index + 1}/${benchmarkWarmupSuiteRunCount}`);
    }

    void runScenarios(index === 0 ? firstRunScenarios : createBenchmarkScenarios());
  }
}

function runBenchmarkSuite() {
  return Array.from({ length: benchmarkSuiteRunCount }, (_, index) => {
    const scenarioRuns = runScenarios(createBenchmarkScenarios());

    if (outputMode === "table") {
      console.log(`Benchmark suite run ${index + 1}/${benchmarkSuiteRunCount}`);
      console.table(formatBenchmarkTableScenarioRuns(scenarioRuns));
    }

    return scenarioRuns;
  });
}

function createBenchmarkScenarios(): BenchmarkScenario[] {
  return [
    ...createMarkdownScenarios(fixtures),
    ...createLayoutScenarios(fixtures),
    ...createComponentScenarios(fixtures),
    ...createEditorScenarios(fixtures),
  ];
}

function runScenarios(scenarios: readonly BenchmarkScenario[]): BenchmarkScenarioRun[] {
  return benchmarkGroupOrder.flatMap((groupId) =>
    runBenchmarkScenarios(
      groupId,
      manifest.benchmarks[groupId],
      selectGroupScenarios(scenarios, groupId),
    ),
  );
}

function selectGroupScenarios(scenarios: readonly BenchmarkScenario[], groupId: BenchmarkGroupId) {
  return scenarios.filter((scenario) => scenario.groupId === groupId);
}

function formatBudgetFailureMessage(failures: RepeatedBudgetFailure[]) {
  return failures
    .map((failure) => {
      const p99Values = failure.scenarioRuns
        .map((scenarioRun) => scenarioRun.p99Ms.toFixed(3))
        .join(", ");

      return `${failure.id} exceeded budget in ${failure.failureCount}/${benchmarkSuiteRunCount} suite runs: p99=[${p99Values}] budget=${failure.budgetMs.toFixed(3)}ms`;
    })
    .join("\n");
}

function resolveOutputMode(argv: string[]): OutputMode {
  return argv.includes("--json") ? "json" : "table";
}
