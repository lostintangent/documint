import { createEditorLayoutState, createEditorState, createLayoutCache } from "@/editor";
import { parseDocument } from "@/markdown";
import type { BenchmarkBudgetTree, BenchmarkRecord } from "./shared";
import { runBudgetedBenchmark } from "./shared";

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
    runBudgetedBenchmark(
      budgets,
      "layout_canvas",
      100,
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
    runBudgetedBenchmark(
      budgets,
      "layout_canvas_xlarge",
      50,
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
    runBudgetedBenchmark(
      budgets,
      "layout_canvas_huge",
      30,
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
    runBudgetedBenchmark(budgets, "layout_scroll", 100, () => {
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
    runBudgetedBenchmark(
      budgets,
      "layout_scroll_step",
      200,
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
    runBudgetedBenchmark(budgets, "layout_scroll_xlarge", 50, () => {
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
    runBudgetedBenchmark(
      budgets,
      "layout_scroll_step_xlarge",
      100,
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
    runBudgetedBenchmark(budgets, "layout_scroll_huge", 30, () => {
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
    runBudgetedBenchmark(
      budgets,
      "layout_scroll_step_huge",
      50,
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
    runBudgetedBenchmark(
      budgets,
      "layout_full_document_long",
      30,
      () =>
        void createEditorLayoutState(longState, {
          height: 100_000,
          top: 0,
          width: 420,
        }),
    ),
    runBudgetedBenchmark(
      budgets,
      "layout_full_document_xlarge",
      20,
      () =>
        void createEditorLayoutState(xlargeState, {
          height: 100_000,
          top: 0,
          width: 420,
        }),
    ),
    runBudgetedBenchmark(
      budgets,
      "layout_full_document_huge",
      10,
      () =>
        void createEditorLayoutState(hugeState, {
          height: 100_000,
          top: 0,
          width: 420,
        }),
    ),
  ];
}
