import { lightTheme, resolveEditorTheme } from "@/component/lib/themes";
import type { EditorLayoutState } from "@/editor/layout";
import {
  normalizeSelection,
  resolveIndexedBlockContainingPath,
  type EditorState,
} from "@/editor/state";
import { createDocumentFrame } from "@/renderer";

export const BENCHMARK_VIEWPORT = { height: 720, width: 420 } as const;

const warmupIterations = 5;
const frameTheme = resolveEditorTheme(lightTheme);

export type BenchmarkScenario = {
  id: string;
  iterations: number;
  run: () => void;
};

export type BenchmarkScenarioRun = {
  budgetMs: number;
  id: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export function createBenchmarkScenario(
  id: string,
  iterations: number,
  run: () => void,
): BenchmarkScenario {
  return { id, iterations, run };
}

export function runBenchmarkScenario(
  { id, iterations, run }: BenchmarkScenario,
  budgetMs: number,
): BenchmarkScenarioRun {
  const samples: number[] = [];

  for (let index = 0; index < warmupIterations; index += 1) {
    run();
  }

  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    run();
    samples.push(performance.now() - startedAt);
  }

  return { budgetMs, id, ...summarizeSamples(samples) };
}

export function summarizeSamples(samples: readonly number[]) {
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

export function roundMs(value: number) {
  return Number(value.toFixed(3));
}

// The frame a host paints for the current caret or selection, without
// comments, effects, or device scaling.
export function createBenchmarkDocumentFrame(
  state: EditorState,
  layoutState: EditorLayoutState,
  { height, width }: { height: number; width: number } = BENCHMARK_VIEWPORT,
  activeBlockPath = resolveIndexedBlockContainingPath(
    state.documentIndex,
    state.selection.focus.path,
  )?.path ?? null,
) {
  return createDocumentFrame(state, layoutState, {
    activeBlockPath,
    activePath: state.selection.focus.path,
    activeThreadIndex: null,
    commentRanges: [],
    devicePixelRatio: 1,
    height,
    normalizedSelection: normalizeSelection(state),
    now: 0,
    theme: frameTheme,
    width,
  });
}

// Nearest rank: for a fraction in (0, 1], the rank lands in [1, length].
function percentile(sortedSamples: readonly number[], fraction: number) {
  return sortedSamples[Math.ceil(sortedSamples.length * fraction) - 1]!;
}
