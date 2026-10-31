import { summarizeSamples } from "./stats";

export const BENCHMARK_VIEWPORT = { height: 720, width: 420 } as const;
export const BENCHMARK_WARMUP_ITERATIONS = 5;
export const FULL_DOCUMENT_VIEWPORT_HEIGHT = 100_000;

export type BenchmarkScenarioRun = {
  budgetMs: number;
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

export function runBenchmarkScenario(
  { id, iterations, run }: BenchmarkScenario,
  budgetMs: number,
): BenchmarkScenarioRun {
  const samples: number[] = [];

  for (let index = 0; index < BENCHMARK_WARMUP_ITERATIONS; index += 1) {
    run();
  }

  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    run();
    samples.push(performance.now() - startedAt);
  }

  return { budgetMs, id, ...summarizeSamples(samples) };
}
