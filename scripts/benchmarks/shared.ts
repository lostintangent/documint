export type BenchmarkRecord = {
  budgetMs?: number;
  iterations: number;
  name: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export type BenchmarkBudgetTree = {
  component: BenchmarkBudgetGroup;
  editor: BenchmarkBudgetGroup;
  layout: BenchmarkBudgetGroup;
  markdown: BenchmarkBudgetGroup;
  sync: BenchmarkBudgetGroup;
};

export type BenchmarkBudgetGroup = Record<string, number>;

export function percentile(values: number[], fraction: number) {
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1));

  return values[index];
}

export function runBenchmark(
  name: string,
  iterations: number,
  budgetMs: number | undefined,
  task: () => void,
): BenchmarkRecord {
  const samples: number[] = [];
  const warmupIterations = 5;

  for (let index = 0; index < warmupIterations; index += 1) {
    task();
  }

  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    task();
    samples.push(performance.now() - startedAt);
  }

  samples.sort((left, right) => left - right);

  return {
    budgetMs,
    iterations,
    name,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
  };
}

export function runBudgetedBenchmark(
  budgets: BenchmarkBudgetGroup,
  name: string,
  iterations: number,
  task: () => void,
) {
  const budgetMs = budgets[name];

  if (budgetMs === undefined) {
    throw new Error(`Missing benchmark budget: ${name}`);
  }

  return runBenchmark(name, iterations, budgetMs, task);
}
