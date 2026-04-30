export type BenchmarkRecord = {
  budgetMs?: number;
  iterations: number;
  name: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export type BenchmarkBudgetTree = {
  component: {
    reconcile_selection_long: number;
    reconcile_transient_empty_paragraph_long: number;
  };
  editor: {
    backspace_long: number;
    backspace_medium: number;
    comment_repair_dense: number;
    comment_toggle_dense: number;
    copy_long: number;
    cursor_move: number;
    cursor_move_huge: number;
    cursor_move_xlarge: number;
    export: number;
    export_medium: number;
    export_rich: number;
    hit_test: number;
    hit_test_huge: number;
    hit_test_xlarge: number;
    import: number;
    import_comments: number;
    import_medium: number;
    import_rich: number;
    linebreak_list: number;
    linebreak_medium: number;
    paste_blocks_long: number;
    paste_inlines_dense: number;
    typing_code: number;
    typing_comments_elsewhere: number;
    typing_long: number;
    typing_medium: number;
    typing_small: number;
    typing_table: number;
  };
  layout: {
    canvas: number;
    canvas_huge: number;
    canvas_xlarge: number;
    scroll: number;
    scroll_huge: number;
    scroll_step: number;
    scroll_step_huge: number;
    scroll_step_xlarge: number;
    scroll_xlarge: number;
  };
  markdown: {
    document_to_markdown: number;
    document_to_markdown_comments: number;
    document_to_markdown_medium: number;
    document_to_markdown_rich: number;
    document_to_markdown_short: number;
    markdown_to_document: number;
    markdown_to_document_comments: number;
    markdown_to_document_medium: number;
    markdown_to_document_rich: number;
    markdown_to_document_short: number;
  };
};

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
