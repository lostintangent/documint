export type BenchmarkSampleSummary = {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export function summarizeSamples(samples: readonly number[]): BenchmarkSampleSummary {
  const sortedSamples = sortSamples(samples);

  return {
    p50Ms: percentile(sortedSamples, 0.5),
    p95Ms: percentile(sortedSamples, 0.95),
    p99Ms: percentile(sortedSamples, 0.99),
  };
}

export function percentile(sortedSamples: readonly number[], fraction: number) {
  assertNonEmptySamples(sortedSamples);

  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil(sortedSamples.length * fraction) - 1),
  );

  return sortedSamples[index]!;
}

export function sortSamples(samples: readonly number[]) {
  assertNonEmptySamples(samples);

  return [...samples].sort((left, right) => left - right);
}

function assertNonEmptySamples(samples: readonly number[]) {
  if (samples.length === 0) {
    throw new Error("Expected at least one benchmark sample");
  }
}
