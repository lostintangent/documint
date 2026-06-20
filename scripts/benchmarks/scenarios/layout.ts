import { createEditorLayoutState, createEditorState, createLayoutCache } from "@/editor";
import { parseDocument } from "@/markdown";
import { BENCHMARK_VIEWPORT, type BenchmarkScenario } from "../harness";
import { createBenchmarkScenario } from "../harness";

type LayoutFixtureSize = "huge" | "long" | "xlarge";

export function createLayoutScenarios(fixtures: {
  hugeMarkdown: string;
  longMarkdown: string;
  mediumMarkdown: string;
  xlargeMarkdown: string;
}): BenchmarkScenario[] {
  const longState = createEditorState(parseDocument(fixtures.longMarkdown));
  const xlargeState = createEditorState(parseDocument(fixtures.xlargeMarkdown));
  const hugeState = createEditorState(parseDocument(fixtures.hugeMarkdown));
  const layoutCache = createLayoutCache();
  const statesBySize = {
    huge: hugeState,
    long: longState,
    xlarge: xlargeState,
  } satisfies Record<LayoutFixtureSize, typeof longState>;
  const scrollViewport = { height: BENCHMARK_VIEWPORT.height };
  const scrollStepTop = BENCHMARK_VIEWPORT.height;
  const scrollOffsets = Array.from(
    { length: 6 },
    (_, index) => index * BENCHMARK_VIEWPORT.height,
  );
  const canvasScenarios = [
    { id: "layout_canvas", iterations: 100, size: "long" },
    { id: "layout_canvas_xlarge", iterations: 50, size: "xlarge" },
    { id: "layout_canvas_huge", iterations: 30, size: "huge" },
  ] as const satisfies Array<{ id: string; iterations: number; size: LayoutFixtureSize }>;
  const scrollScenarios = [
    { id: "layout_scroll", iterations: 100, size: "long" },
    { id: "layout_scroll_xlarge", iterations: 50, size: "xlarge" },
    { id: "layout_scroll_huge", iterations: 30, size: "huge" },
  ] as const satisfies Array<{ id: string; iterations: number; size: LayoutFixtureSize }>;
  const scrollStepScenarios = [
    { id: "layout_scroll_step", iterations: 200, size: "long" },
    { id: "layout_scroll_step_xlarge", iterations: 100, size: "xlarge" },
    { id: "layout_scroll_step_huge", iterations: 50, size: "huge" },
  ] as const satisfies Array<{ id: string; iterations: number; size: LayoutFixtureSize }>;

  return [
    ...canvasScenarios.map(({ id, iterations, size }) =>
      createBenchmarkScenario(
        "layout",
        id,
        iterations,
        () =>
          void createEditorLayoutState(
            statesBySize[size],
            {
              height: BENCHMARK_VIEWPORT.height,
              top: 0,
              width: BENCHMARK_VIEWPORT.width,
            },
            layoutCache,
          ),
      ),
    ),
    ...scrollScenarios.map(({ id, iterations, size }) =>
      createBenchmarkScenario(
        "layout",
        id,
        iterations,
        () => {
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
        },
      ),
    ),
    ...scrollStepScenarios.map(({ id, iterations, size }) =>
      createBenchmarkScenario(
        "layout",
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
