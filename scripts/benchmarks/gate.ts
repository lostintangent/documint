import type { BenchmarkBudgetTree, BenchmarkScenario, BenchmarkScenarioRun } from "./harness";

export type RepeatedBudgetFailure = {
  budgetMs: number;
  failureCount: number;
  id: string;
  scenarioRuns: BenchmarkScenarioRun[];
};

export function collectRepeatedBudgetFailures(
  suiteRuns: BenchmarkScenarioRun[][],
  allowedBudgetFailureCount: number,
): RepeatedBudgetFailure[] {
  const scenarioRunsById = groupBenchmarkScenarioRunsById(suiteRuns);

  return [...scenarioRunsById.entries()].flatMap(([id, scenarioRuns]) => {
    const budgetMs = resolveBenchmarkBudget(scenarioRuns);

    if (budgetMs === undefined) {
      return [];
    }

    const failureCount = scenarioRuns.filter((scenarioRun) => scenarioRun.p99Ms > budgetMs).length;

    return failureCount > allowedBudgetFailureCount
      ? [
          {
            budgetMs,
            failureCount,
            id,
            scenarioRuns,
          },
        ]
      : [];
  });
}

export function collectDuplicateBenchmarkIds(items: readonly { id: string }[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const item of items) {
    if (seen.has(item.id)) {
      duplicates.add(item.id);
    } else {
      seen.add(item.id);
    }
  }

  return [...duplicates].sort();
}

export function collectUnusedBenchmarkBudgets(
  budgets: BenchmarkBudgetTree,
  scenarios: readonly BenchmarkScenario[],
) {
  const benchmarkNames = new Set(scenarios.map((scenario) => scenario.id));

  return collectBenchmarkBudgetNames(budgets)
    .filter((name) => !benchmarkNames.has(name))
    .sort();
}

export function collectMissingBenchmarkBudgets(
  budgets: BenchmarkBudgetTree,
  scenarios: readonly BenchmarkScenario[],
) {
  return scenarios
    .filter((scenario) => budgets[scenario.groupId][scenario.id] === undefined)
    .map((scenario) => scenario.id)
    .sort();
}

function groupBenchmarkScenarioRunsById(suiteRuns: BenchmarkScenarioRun[][]) {
  const scenarioRunsById = new Map<string, BenchmarkScenarioRun[]>();

  for (const suiteRun of suiteRuns) {
    for (const scenarioRun of suiteRun) {
      const scenarioRuns = scenarioRunsById.get(scenarioRun.id) ?? [];

      scenarioRuns.push(scenarioRun);
      scenarioRunsById.set(scenarioRun.id, scenarioRuns);
    }
  }

  return scenarioRunsById;
}

function resolveBenchmarkBudget(scenarioRuns: BenchmarkScenarioRun[]) {
  return scenarioRuns.find((scenarioRun) => scenarioRun.budgetMs !== undefined)?.budgetMs;
}

function collectBenchmarkBudgetNames(budgets: BenchmarkBudgetTree) {
  return Object.values(budgets).flatMap((group) => Object.keys(group));
}
