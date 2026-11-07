import {
  createEditorLayoutState,
  createEditorState,
  createLayoutCache,
  insertText,
} from "@/editor";
import { parseDocument } from "@/markdown";
import type { BenchmarkFixtures } from "../fixtures";
import { BENCHMARK_VIEWPORT, createBenchmarkScenario, type BenchmarkScenario } from "../harness";

type LayoutFixtureSize = "dense" | "huge" | "long" | "xlarge";

export function createLayoutScenarios(fixtures: BenchmarkFixtures): BenchmarkScenario[] {
  const longState = createEditorState(parseDocument(fixtures.longMarkdown));
  const xlargeState = createEditorState(parseDocument(fixtures.xlargeMarkdown));
  const hugeState = createEditorState(parseDocument(fixtures.hugeMarkdown));
  const denseState = createEditorState(parseDocument(fixtures.denseMarkdown));
  const denseTypedState = insertText(denseState, "x");

  if (!denseTypedState) {
    throw new Error("insertText returned null");
  }

  const metadataState = createEditorState(fixtures.metadataSnapshot);
  const layoutCache = createLayoutCache();
  const statesBySize = {
    dense: denseState,
    huge: hugeState,
    long: longState,
    xlarge: xlargeState,
  } satisfies Record<LayoutFixtureSize, typeof longState>;
  const scrollViewport = { height: BENCHMARK_VIEWPORT.height };
  const scrollStepTop = BENCHMARK_VIEWPORT.height;
  const scrollOffsets = Array.from({ length: 6 }, (_, index) => index * BENCHMARK_VIEWPORT.height);
  const canvasScenarios = [
    { id: "layout_canvas", iterations: 100, size: "long" },
    { id: "layout_canvas_xlarge", iterations: 50, size: "xlarge" },
    { id: "layout_canvas_huge", iterations: 100, size: "huge" },
    { id: "layout_canvas_dense", iterations: 100, size: "dense" },
  ] as const satisfies Array<{ id: string; iterations: number; size: LayoutFixtureSize }>;
  const scrollScenarios = [
    { id: "layout_scroll", iterations: 100, size: "long" },
    { id: "layout_scroll_xlarge", iterations: 100, size: "xlarge" },
    { id: "layout_scroll_huge", iterations: 100, size: "huge" },
    { id: "layout_scroll_dense", iterations: 100, size: "dense" },
  ] as const satisfies Array<{ id: string; iterations: number; size: LayoutFixtureSize }>;
  const scrollStepScenarios = [
    { id: "layout_scroll_step", iterations: 200, size: "long" },
    { id: "layout_scroll_step_xlarge", iterations: 100, size: "xlarge" },
    { id: "layout_scroll_step_huge", iterations: 100, size: "huge" },
  ] as const satisfies Array<{ id: string; iterations: number; size: LayoutFixtureSize }>;

  return [
    createBenchmarkScenario("layout_metadata_prefix", 100, () => {
      void createEditorLayoutState(
        metadataState,
        {
          height: BENCHMARK_VIEWPORT.height,
          metadataExpanded: true,
          top: 0,
          width: BENCHMARK_VIEWPORT.width,
        },
        createLayoutCache(),
      );
    }),
    ...canvasScenarios.map(({ id, iterations, size }) => {
      // A full layout is reused until its document changes, so the dense
      // document alternates with a one-character edit, like typing.
      const states = size === "dense" ? [denseState, denseTypedState] : [statesBySize[size]];
      let iteration = 0;

      return createBenchmarkScenario(
        id,
        iterations,
        () =>
          void createEditorLayoutState(
            states[iteration++ % states.length]!,
            {
              height: BENCHMARK_VIEWPORT.height,
              top: 0,
              width: BENCHMARK_VIEWPORT.width,
            },
            layoutCache,
          ),
      );
    }),
    ...scrollScenarios.map(({ id, iterations, size }) =>
      createBenchmarkScenario(id, iterations, () => {
        for (const top of scrollOffsets) {
          void createEditorLayoutState(
            statesBySize[size],
            {
              ...scrollViewport,
              top,
              width: BENCHMARK_VIEWPORT.width,
            },
            layoutCache,
          );
        }
      }),
    ),
    ...scrollStepScenarios.map(({ id, iterations, size }) =>
      createBenchmarkScenario(
        id,
        iterations,
        () =>
          void createEditorLayoutState(
            statesBySize[size],
            {
              ...scrollViewport,
              top: scrollStepTop,
              width: BENCHMARK_VIEWPORT.width,
            },
            layoutCache,
          ),
      ),
    ),
  ];
}
