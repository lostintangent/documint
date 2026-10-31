import type { RepeatedBudgetFailure } from "./gate";
import type { BenchmarkScenarioRun } from "./harness";

const schemaVersion = 1;

export function formatBenchmarkJson(input: {
  failures: RepeatedBudgetFailure[];
  suiteRuns: BenchmarkScenarioRun[][];
}) {
  const json = {
    schemaVersion,
    pass: input.failures.length === 0,
    failures: input.failures
      .map((failure) => ({
        budgetMs: roundMs(failure.budgetMs),
        failureCount: failure.failureCount,
        id: failure.id,
        p99Ms: failure.scenarioRuns.map((scenarioRun) => roundMs(scenarioRun.p99Ms)),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    suiteRuns: input.suiteRuns.map((scenarioRuns, index) => ({
      index: index + 1,
      scenarioRuns: scenarioRuns
        .map((scenarioRun) => ({
          budgetMs: roundMs(scenarioRun.budgetMs),
          budgetExceeded: scenarioRun.p99Ms > scenarioRun.budgetMs,
          id: scenarioRun.id,
          ...roundPercentiles(scenarioRun),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    })),
  };

  return JSON.stringify(json, null, 2);
}

export function formatBenchmarkTableScenarioRuns(scenarioRuns: readonly BenchmarkScenarioRun[]) {
  return scenarioRuns.map((scenarioRun) => ({
    benchmark: scenarioRun.id,
    ...roundPercentiles(scenarioRun),
    budgetMs: roundMs(scenarioRun.budgetMs),
  }));
}

function roundPercentiles({ p50Ms, p95Ms, p99Ms }: BenchmarkScenarioRun) {
  return { p50Ms: roundMs(p50Ms), p95Ms: roundMs(p95Ms), p99Ms: roundMs(p99Ms) };
}

function roundMs(value: number) {
  return Number(value.toFixed(3));
}
