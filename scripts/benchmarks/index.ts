import "../../test/setup-canvas";
import { createBenchmarkFixtures } from "./fixtures";
import {
  roundMs,
  runBenchmarkScenario,
  type BenchmarkScenario,
  type BenchmarkScenarioRun,
} from "./harness";
import manifest from "./manifest.json";
import { createComponentScenarios } from "./scenarios/component";
import { createEditorScenarios } from "./scenarios/editor";
import { createLayoutScenarios } from "./scenarios/layout";
import { createMarkdownScenarios } from "./scenarios/markdown";

type BudgetedScenario = BenchmarkScenario & { budgetMs: number | undefined };

// Each scenario module owns one budget group, and suites run in this order.
const scenarioGroups = {
  markdown: createMarkdownScenarios,
  layout: createLayoutScenarios,
  component: createComponentScenarios,
  editor: createEditorScenarios,
};
const budgets: Record<string, Record<string, number>> = manifest.benchmarks;
const suiteRunCount = 3;
const allowedBudgetFailureCount = 1;
const fixtures = await createBenchmarkFixtures();

// The discarded warmup suite reuses the scenario set that passed validation.
const warmupScenarios = createBenchmarkScenarios();
validateBudgets(warmupScenarios);
console.log("Benchmark suite warmup");
runScenarios(warmupScenarios);

const suiteRuns = Array.from({ length: suiteRunCount }, (_, index) => {
  const scenarioRuns = runScenarios(createBenchmarkScenarios());

  console.log(`Benchmark suite run ${index + 1}/${suiteRunCount}`);
  console.table(
    scenarioRuns.map(({ budgetMs, id, p50Ms, p95Ms, p99Ms }) => ({
      benchmark: id,
      p50Ms: roundMs(p50Ms),
      p95Ms: roundMs(p95Ms),
      p99Ms: roundMs(p99Ms),
      budgetMs: roundMs(budgetMs),
    })),
  );

  return scenarioRuns;
});
const failures = collectRepeatedBudgetFailures(suiteRuns);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}

function createBenchmarkScenarios(): BudgetedScenario[] {
  return Object.entries(scenarioGroups).flatMap(([group, createScenarios]) =>
    createScenarios(fixtures).map((scenario) => ({
      ...scenario,
      budgetMs: budgets[group]?.[scenario.id],
    })),
  );
}

// Every scenario needs exactly one budget in its group, and every budget needs
// a scenario, so renaming either side is a budget migration.
function validateBudgets(scenarios: readonly BudgetedScenario[]) {
  const ids = scenarios.map(({ id }) => id);
  const problems = [
    ["Duplicate benchmark scenario ids", ids.filter((id, index) => ids.indexOf(id) !== index)],
    [
      "Missing benchmark budgets for scenario ids",
      scenarios.filter(({ budgetMs }) => budgetMs === undefined).map(({ id }) => id),
    ],
    [
      "Unused benchmark budget ids",
      Object.values(budgets)
        .flatMap((group) => Object.keys(group))
        .filter((id) => !ids.includes(id)),
    ],
  ] as const;
  const message = problems
    .filter(([, problemIds]) => problemIds.length > 0)
    .map(([label, problemIds]) => `${label}: ${[...new Set(problemIds)].sort().join(", ")}`)
    .join("\n");

  if (message) {
    throw new Error(message);
  }
}

// Startup validation guarantees every scenario id has a budget.
function runScenarios(scenarios: readonly BudgetedScenario[]) {
  return scenarios.map((scenario) => runBenchmarkScenario(scenario, scenario.budgetMs!));
}

// One slow suite run is noise. A scenario fails only when its p99 exceeds the
// budget in more than the allowed number of runs. Every suite builds the same
// scenarios in the same order, so runs line up by index.
function collectRepeatedBudgetFailures(suiteRuns: readonly BenchmarkScenarioRun[][]) {
  return suiteRuns[0]!.flatMap(({ budgetMs, id }, index) => {
    const scenarioRuns = suiteRuns.map((suiteRun) => suiteRun[index]!);
    const failureCount = scenarioRuns.filter(({ p99Ms }) => p99Ms > budgetMs).length;
    const p99Values = scenarioRuns.map(({ p99Ms }) => p99Ms.toFixed(3)).join(", ");

    return failureCount > allowedBudgetFailureCount
      ? [
          `${id} exceeded budget in ${failureCount}/${suiteRunCount} suite runs: p99=[${p99Values}] budget=${budgetMs.toFixed(3)}ms`,
        ]
      : [];
  });
}
