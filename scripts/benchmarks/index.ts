import "../../test/setup-canvas";
import { createBenchmarkFixtures, type BenchmarkManifest } from "./fixtures";
import {
  collectDuplicateBenchmarkIds,
  collectMissingBenchmarkBudgets,
  collectRepeatedBudgetFailures,
  collectUnusedBenchmarkBudgets,
  type RepeatedBudgetFailure,
} from "./gate";
import { formatBenchmarkJson, formatBenchmarkTableScenarioRuns } from "./output";
import { createComponentScenarios } from "./scenarios/component";
import { createEditorScenarios } from "./scenarios/editor";
import { createLayoutScenarios } from "./scenarios/layout";
import { createMarkdownScenarios } from "./scenarios/markdown";
import { runBenchmarkScenario, type BenchmarkScenarioRun, type BenchmarkScenario } from "./harness";

type OutputMode = "json" | "table";

const manifestPath = new URL("./manifest.json", import.meta.url);
const manifest = (await Bun.file(manifestPath).json()) as BenchmarkManifest;
const benchmarkSuiteRunCount = 3;
const allowedBudgetFailureCount = 1;
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

runBenchmarkWarmupSuite();
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

// The discarded warmup suite reuses the scenario set that passed validation.
function runBenchmarkWarmupSuite() {
  if (outputMode === "table") {
    console.log("Benchmark suite warmup");
  }

  void runScenarios(benchmarkScenarios);
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

// Startup validation guarantees every scenario id has a budget.
function runScenarios(scenarios: readonly BenchmarkScenario[]): BenchmarkScenarioRun[] {
  return scenarios.map((scenario) =>
    runBenchmarkScenario(scenario, manifest.benchmarks[scenario.groupId][scenario.id]!),
  );
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
