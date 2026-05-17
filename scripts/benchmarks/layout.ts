import { createEditorLayoutState, createEditorState, createLayoutCache } from "@/editor";
import { parseDocument } from "@/markdown";
import type { BenchmarkBudgetTree, BenchmarkRecord } from "./shared";
import { runBenchmark } from "./shared";

export function createLayoutBenchmarks(
  budgets: BenchmarkBudgetTree["layout"],
  fixtures: {
    hugeMarkdown: string;
    longMarkdown: string;
    mediumMarkdown: string;
    xlargeMarkdown: string;
  },
): BenchmarkRecord[] {
  const longState = createEditorState(parseDocument(fixtures.longMarkdown));
  const xlargeState = createEditorState(parseDocument(fixtures.xlargeMarkdown));
  const hugeState = createEditorState(parseDocument(fixtures.hugeMarkdown));
  const layoutCache = createLayoutCache();
  const scrollViewport = { height: 720 };
  const scrollStepTop = 720;
  const scrollOffsets = [0, 720, 1440, 2160, 2880, 3600];

  return [
    runBenchmark(
      "layout_canvas",
      100,
      budgets.canvas,
      () =>
        void createEditorLayoutState(
          longState,
          {
            height: 720,
            top: 0,
            width: 420,
          },
          layoutCache,
        ),
    ),
    runBenchmark(
      "layout_canvas_xlarge",
      50,
      budgets.canvas_xlarge,
      () =>
        void createEditorLayoutState(
          xlargeState,
          {
            height: 720,
            top: 0,
            width: 420,
          },
          layoutCache,
        ),
    ),
    runBenchmark(
      "layout_canvas_huge",
      30,
      budgets.canvas_huge,
      () =>
        void createEditorLayoutState(
          hugeState,
          {
            height: 720,
            top: 0,
            width: 420,
          },
          layoutCache,
        ),
    ),
    runBenchmark("layout_scroll", 100, budgets.scroll, () => {
      for (const top of scrollOffsets) {
        void createEditorLayoutState(
          longState,
          {
            ...scrollViewport,
            top,
            width: 420,
          },
          layoutCache,
        );
      }
    }),
    runBenchmark(
      "layout_scroll_step",
      200,
      budgets.scroll_step,
      () =>
        void createEditorLayoutState(
          longState,
          {
            ...scrollViewport,
            top: scrollStepTop,
            width: 420,
          },
          layoutCache,
        ),
    ),
    runBenchmark("layout_scroll_xlarge", 50, budgets.scroll_xlarge, () => {
      for (const top of scrollOffsets) {
        void createEditorLayoutState(
          xlargeState,
          {
            ...scrollViewport,
            top,
            width: 420,
          },
          layoutCache,
        );
      }
    }),
    runBenchmark(
      "layout_scroll_step_xlarge",
      100,
      budgets.scroll_step_xlarge,
      () =>
        void createEditorLayoutState(
          xlargeState,
          {
            ...scrollViewport,
            top: scrollStepTop,
            width: 420,
          },
          layoutCache,
        ),
    ),
    runBenchmark("layout_scroll_huge", 30, budgets.scroll_huge, () => {
      for (const top of scrollOffsets) {
        void createEditorLayoutState(
          hugeState,
          {
            ...scrollViewport,
            top,
            width: 420,
          },
          layoutCache,
        );
      }
    }),
    runBenchmark(
      "layout_scroll_step_huge",
      50,
      budgets.scroll_step_huge,
      () =>
        void createEditorLayoutState(
          hugeState,
          {
            ...scrollViewport,
            top: scrollStepTop,
            width: 420,
          },
          layoutCache,
        ),
    ),
    // Tall-viewport layout. Uses the public editor layout entrypoint while
    // forcing a viewport large enough to exercise more measured geometry than
    // the ordinary scroll benchmarks.
    runBenchmark(
      "layout_full_document_long",
      30,
      budgets.full_document_long,
      () =>
        void createEditorLayoutState(longState, {
          height: 100_000,
          top: 0,
          width: 420,
        }),
    ),
    runBenchmark(
      "layout_full_document_xlarge",
      20,
      budgets.full_document_xlarge,
      () =>
        void createEditorLayoutState(xlargeState, {
          height: 100_000,
          top: 0,
          width: 420,
        }),
    ),
    runBenchmark(
      "layout_full_document_huge",
      10,
      budgets.full_document_huge,
      () =>
        void createEditorLayoutState(hugeState, {
          height: 100_000,
          top: 0,
          width: 420,
        }),
    ),
  ];
}
