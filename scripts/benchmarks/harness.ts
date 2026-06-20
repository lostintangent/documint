import { summarizeSamples } from "./stats";

export const BENCHMARK_VIEWPORT = { height: 720, width: 420 } as const;
export const BENCHMARK_WARMUP_ITERATIONS = 5;
export const FULL_DOCUMENT_VIEWPORT_HEIGHT = 100_000;

export type BenchmarkScenarioRun = {
  budgetMs?: number;
  id: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export type BenchmarkBudgetTree = {
  component: BenchmarkBudgetGroup;
  editor: BenchmarkBudgetGroup;
  layout: BenchmarkBudgetGroup;
  markdown: BenchmarkBudgetGroup;
};

export type BenchmarkBudgetGroup = Record<string, number>;
export type BenchmarkGroupId = keyof BenchmarkBudgetTree;

export type BenchmarkScenario = {
  groupId: BenchmarkGroupId;
  id: string;
  iterations: number;
  run: () => void;
};

export function createBenchmarkScenario(
  groupId: BenchmarkGroupId,
  id: string,
  iterations: number,
  run: () => void,
): BenchmarkScenario {
  return {
    groupId,
    id,
    iterations,
    run,
  };
}

export function runBenchmark(
  id: string,
  iterations: number,
  budgetMs: number | undefined,
  task: () => void,
): BenchmarkScenarioRun {
  const samples: number[] = [];

  for (let index = 0; index < BENCHMARK_WARMUP_ITERATIONS; index += 1) {
    task();
  }

  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    task();
    samples.push(performance.now() - startedAt);
  }

  const summary = summarizeSamples(samples);

  return {
    budgetMs,
    id,
    p50Ms: summary.p50Ms,
    p95Ms: summary.p95Ms,
    p99Ms: summary.p99Ms,
  };
}

export function runBudgetedBenchmark(
  budgets: BenchmarkBudgetGroup,
  id: string,
  iterations: number,
  task: () => void,
) {
  const budgetMs = budgets[id];

  if (budgetMs === undefined) {
    throw new Error(`Missing benchmark budget: ${id}`);
  }

  return runBenchmark(id, iterations, budgetMs, task);
}

export function runBenchmarkScenario(
  groupId: BenchmarkGroupId,
  budgets: BenchmarkBudgetGroup,
  scenario: BenchmarkScenario,
) {
  if (scenario.groupId !== groupId) {
    throw new Error(
      `Benchmark scenario ${scenario.id} belongs to ${scenario.groupId}, not ${groupId}`,
    );
  }

  return runBudgetedBenchmark(
    budgets,
    scenario.id,
    scenario.iterations,
    scenario.run,
  );
}

export function runBenchmarkScenarios(
  groupId: BenchmarkGroupId,
  budgets: BenchmarkBudgetGroup,
  scenarios: readonly BenchmarkScenario[],
) {
  return scenarios.map((scenario) => runBenchmarkScenario(groupId, budgets, scenario));
}
