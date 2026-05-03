import { createDocumentIndex } from "@/editor/state";
import { createCanvasRenderCache } from "@/editor/canvas/lib/cache";
import { createDocumentLayout, createViewportLayout } from "@/editor/layout";
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
  const longRuntime = createDocumentIndex(parseDocument(fixtures.longMarkdown));
  const xlargeRuntime = createDocumentIndex(parseDocument(fixtures.xlargeMarkdown));
  const hugeRuntime = createDocumentIndex(parseDocument(fixtures.hugeMarkdown));
  const renderCache = createCanvasRenderCache();
  const scrollViewport = {
    height: 720,
    overscan: 720,
  };
  const scrollStepTop = 720;
  const scrollOffsets = [0, 720, 1440, 2160, 2880, 3600];

  return [
    runBenchmark(
      "layout_canvas",
      100,
      budgets.canvas,
      () =>
        void createViewportLayout(
          longRuntime,
          {
            width: 420,
          },
          {
            height: 720,
            overscan: 720,
            top: 0,
          },
          [],
          renderCache,
        ),
    ),
    runBenchmark(
      "layout_canvas_xlarge",
      50,
      budgets.canvas_xlarge,
      () =>
        void createViewportLayout(
          xlargeRuntime,
          {
            width: 420,
          },
          {
            height: 720,
            overscan: 720,
            top: 0,
          },
          [],
          renderCache,
        ),
    ),
    runBenchmark(
      "layout_canvas_huge",
      30,
      budgets.canvas_huge,
      () =>
        void createViewportLayout(
          hugeRuntime,
          {
            width: 420,
          },
          {
            height: 720,
            overscan: 720,
            top: 0,
          },
          [],
          renderCache,
        ),
    ),
    runBenchmark("layout_scroll", 100, budgets.scroll, () => {
      for (const top of scrollOffsets) {
        void createViewportLayout(
          longRuntime,
          {
            width: 420,
          },
          {
            ...scrollViewport,
            top,
          },
          [],
          renderCache,
        );
      }
    }),
    runBenchmark(
      "layout_scroll_step",
      200,
      budgets.scroll_step,
      () =>
        void createViewportLayout(
          longRuntime,
          {
            width: 420,
          },
          {
            ...scrollViewport,
            top: scrollStepTop,
          },
          [],
          renderCache,
        ),
    ),
    runBenchmark("layout_scroll_xlarge", 50, budgets.scroll_xlarge, () => {
      for (const top of scrollOffsets) {
        void createViewportLayout(
          xlargeRuntime,
          {
            width: 420,
          },
          {
            ...scrollViewport,
            top,
          },
          [],
          renderCache,
        );
      }
    }),
    runBenchmark(
      "layout_scroll_step_xlarge",
      100,
      budgets.scroll_step_xlarge,
      () =>
        void createViewportLayout(
          xlargeRuntime,
          {
            width: 420,
          },
          {
            ...scrollViewport,
            top: scrollStepTop,
          },
          [],
          renderCache,
        ),
    ),
    runBenchmark("layout_scroll_huge", 30, budgets.scroll_huge, () => {
      for (const top of scrollOffsets) {
        void createViewportLayout(
          hugeRuntime,
          {
            width: 420,
          },
          {
            ...scrollViewport,
            top,
          },
          [],
          renderCache,
        );
      }
    }),
    runBenchmark(
      "layout_scroll_step_huge",
      50,
      budgets.scroll_step_huge,
      () =>
        void createViewportLayout(
          hugeRuntime,
          {
            width: 420,
          },
          {
            ...scrollViewport,
            top: scrollStepTop,
          },
          [],
          renderCache,
        ),
    ),
    // Unsliced full-document layout. Exercises the per-region bounds
    // bookkeeping at full-doc scale so we can spot regressions in that
    // path; the viewport benchmarks above only ever build the visible
    // slice and won't expose O(N) → O(N²) drift in region bookkeeping.
    runBenchmark(
      "layout_full_document_long",
      30,
      budgets.full_document_long,
      () =>
        void createDocumentLayout(longRuntime, {
          width: 420,
        }),
    ),
    runBenchmark(
      "layout_full_document_xlarge",
      20,
      budgets.full_document_xlarge,
      () =>
        void createDocumentLayout(xlargeRuntime, {
          width: 420,
        }),
    ),
    runBenchmark(
      "layout_full_document_huge",
      10,
      budgets.full_document_huge,
      () =>
        void createDocumentLayout(hugeRuntime, {
          width: 420,
        }),
    ),
  ];
}
