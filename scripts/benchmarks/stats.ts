type BenchmarkSampleSummary = {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export function summarizeSamples(samples: readonly number[]): BenchmarkSampleSummary {
  if (samples.length === 0) {
    throw new Error("Expected at least one benchmark sample");
  }

  const sortedSamples = [...samples].sort((left, right) => left - right);

  return {
    p50Ms: percentile(sortedSamples, 0.5),
    p95Ms: percentile(sortedSamples, 0.95),
    p99Ms: percentile(sortedSamples, 0.99),
  };
}

// Nearest rank: for a fraction in (0, 1], the rank lands in [1, length].
function percentile(sortedSamples: readonly number[], fraction: number) {
  return sortedSamples[Math.ceil(sortedSamples.length * fraction) - 1]!;
}
