// Focused parser/serializer perf harness — separate from the budget-checked
// benchmark suite. Measures throughput and scaling across many sizes so any
// quadratic behavior or hot-path regression surfaces clearly.
//
// Usage:  bun run scripts/markdown-perf.ts

import { parseDocument, serializeDocument } from "@/markdown";
import { readBenchmarkFixtureMarkdown, buildSyntheticLongFixture } from "@test/utils";

type Sample = {
  label: string;
  sizeKB: number;
  parseP50Ms: number;
  parseP99Ms: number;
  parseThroughputKBs: number;
  serializeP50Ms: number;
  serializeP99Ms: number;
  serializeThroughputKBs: number;
};

const warmupIterations = 5;
const measuredIterations = 100;

const baseFixture = await readBenchmarkFixtureMarkdown("full-spectrum");

const sizes: Array<{ label: string; source: string }> = [
  { label: "sample", source: await readBenchmarkFixtureMarkdown("sample") },
  { label: "full-spectrum (1x)", source: baseFixture },
  { label: "synthetic 10x", source: buildSyntheticLongFixture(baseFixture, 10) },
  { label: "synthetic 90x (long)", source: buildSyntheticLongFixture(baseFixture, 90) },
  { label: "synthetic 360x (huge)", source: buildSyntheticLongFixture(baseFixture, 360) },
  { label: "synthetic 1000x", source: buildSyntheticLongFixture(baseFixture, 1000) },
];

const samples: Sample[] = sizes.map((entry) => measure(entry.label, entry.source));

console.log("\nParser/serializer throughput (warmup=5, iterations=100):\n");
console.table(
  samples.map((sample) => ({
    "size": sample.label,
    "KB": sample.sizeKB.toFixed(1),
    "parse p50 (ms)": sample.parseP50Ms.toFixed(3),
    "parse p99 (ms)": sample.parseP99Ms.toFixed(3),
    "parse KB/ms": sample.parseThroughputKBs.toFixed(2),
    "ser. p50 (ms)": sample.serializeP50Ms.toFixed(3),
    "ser. p99 (ms)": sample.serializeP99Ms.toFixed(3),
    "ser. KB/ms": sample.serializeThroughputKBs.toFixed(2),
  })),
);

console.log("\nScaling — ratio vs. synthetic 10x baseline:\n");
const tenX = samples.find((sample) => sample.label === "synthetic 10x");

if (tenX) {
  console.table(
    samples.map((sample) => {
      const sizeRatio = sample.sizeKB / tenX.sizeKB;
      const parseRatio = sample.parseP50Ms / tenX.parseP50Ms;
      const serializeRatio = sample.serializeP50Ms / tenX.serializeP50Ms;

      return {
        "size": sample.label,
        "size ratio": sizeRatio.toFixed(2) + "x",
        "parse time ratio": parseRatio.toFixed(2) + "x",
        "parse scaling": (parseRatio / sizeRatio).toFixed(2) + "x size",
        "ser. time ratio": serializeRatio.toFixed(2) + "x",
        "ser. scaling": (serializeRatio / sizeRatio).toFixed(2) + "x size",
      };
    }),
  );
}

console.log(
  "\nScaling interpretation: time-ratio / size-ratio should stay close to 1.0 for linear " +
    "behavior. Values >>1 on the larger sizes indicate quadratic or worse hot paths.",
);

function measure(label: string, source: string): Sample {
  const sizeKB = source.length / 1024;
  const parseSamples = collect(measuredIterations, () => void parseDocument(source));
  const snapshot = parseDocument(source);
  const serializeSamples = collect(measuredIterations, () => void serializeDocument(snapshot));

  return {
    label,
    sizeKB,
    parseP50Ms: percentile(parseSamples, 0.5),
    parseP99Ms: percentile(parseSamples, 0.99),
    parseThroughputKBs: sizeKB / percentile(parseSamples, 0.5),
    serializeP50Ms: percentile(serializeSamples, 0.5),
    serializeP99Ms: percentile(serializeSamples, 0.99),
    serializeThroughputKBs: sizeKB / percentile(serializeSamples, 0.5),
  };
}

function collect(iterations: number, task: () => void): number[] {
  for (let index = 0; index < warmupIterations; index += 1) {
    task();
  }

  const samples: number[] = [];

  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    task();
    samples.push(performance.now() - startedAt);
  }

  return samples.sort((left, right) => left - right);
}

function percentile(samples: number[], fraction: number): number {
  const index = Math.min(samples.length - 1, Math.max(0, Math.ceil(samples.length * fraction) - 1));
  return samples[index]!;
}
