import type { RepeatedBudgetFailure } from "./gate";
import type { BenchmarkScenarioRun } from "./harness";

const schemaVersion = 1;

export type BenchmarkJsonInput = {
  failures: RepeatedBudgetFailure[];
  suiteRuns: BenchmarkScenarioRun[][];
};

export function createBenchmarkJson(input: BenchmarkJsonInput) {
  return {
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
        .map(formatBenchmarkScenarioRun)
        .sort((left, right) => left.id.localeCompare(right.id)),
    })),
  };
}

export function formatBenchmarkJson(input: BenchmarkJsonInput) {
  return JSON.stringify(createBenchmarkJson(input), null, 2);
}

export function formatBenchmarkTableScenarioRuns(scenarioRuns: readonly BenchmarkScenarioRun[]) {
  return scenarioRuns.map(formatBenchmarkTableScenarioRun);
}

function formatBenchmarkScenarioRun(scenarioRun: BenchmarkScenarioRun) {
  return {
    ...(scenarioRun.budgetMs === undefined ? {} : { budgetMs: roundMs(scenarioRun.budgetMs) }),
    budgetExceeded:
      scenarioRun.budgetMs === undefined ? false : scenarioRun.p99Ms > scenarioRun.budgetMs,
    id: scenarioRun.id,
    p50Ms: roundMs(scenarioRun.p50Ms),
    p95Ms: roundMs(scenarioRun.p95Ms),
    p99Ms: roundMs(scenarioRun.p99Ms),
  };
}

function formatBenchmarkTableScenarioRun(scenarioRun: BenchmarkScenarioRun) {
  return {
    benchmark: scenarioRun.id,
    p50Ms: roundMs(scenarioRun.p50Ms),
    p95Ms: roundMs(scenarioRun.p95Ms),
    p99Ms: roundMs(scenarioRun.p99Ms),
    ...(scenarioRun.budgetMs === undefined ? {} : { budgetMs: roundMs(scenarioRun.budgetMs) }),
  };
}

function roundMs(value: number) {
  return Number(value.toFixed(3));
}
