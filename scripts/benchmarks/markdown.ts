import { parseDocument, serializeDocument } from "@/markdown";
import type { BenchmarkBudgetTree, BenchmarkRecord } from "./shared";
import { runBudgetedBenchmark } from "./shared";

export function createMarkdownBenchmarks(
  budgets: BenchmarkBudgetTree["markdown"],
  fixtures: {
    commentsMarkdown: string;
    commentsSnapshot: ReturnType<typeof parseDocument>;
    longMarkdown: string;
    mediumMarkdown: string;
    mediumSnapshot: ReturnType<typeof parseDocument>;
    richMixedMarkdown: string;
    richMixedSnapshot: ReturnType<typeof parseDocument>;
    sampleMarkdown: string;
    sampleSnapshot: ReturnType<typeof parseDocument>;
    longSnapshot: ReturnType<typeof parseDocument>;
  },
): BenchmarkRecord[] {
  return [
    runBudgetedBenchmark(
      budgets,
      "markdown_to_document_comments",
      200,
      () => void parseDocument(fixtures.commentsMarkdown),
    ),
    runBudgetedBenchmark(
      budgets,
      "markdown_to_document_short",
      200,
      () => void parseDocument(fixtures.sampleMarkdown),
    ),
    runBudgetedBenchmark(
      budgets,
      "markdown_to_document_medium",
      200,
      () => void parseDocument(fixtures.mediumMarkdown),
    ),
    runBudgetedBenchmark(
      budgets,
      "markdown_to_document",
      100,
      () => void parseDocument(fixtures.longMarkdown),
    ),
    runBudgetedBenchmark(
      budgets,
      "markdown_to_document_rich",
      200,
      () => void parseDocument(fixtures.richMixedMarkdown),
    ),
    runBudgetedBenchmark(
      budgets,
      "document_to_markdown_comments",
      200,
      () => void serializeDocument(fixtures.commentsSnapshot),
    ),
    runBudgetedBenchmark(
      budgets,
      "document_to_markdown_short",
      200,
      () => void serializeDocument(fixtures.sampleSnapshot),
    ),
    runBudgetedBenchmark(
      budgets,
      "document_to_markdown_medium",
      200,
      () => void serializeDocument(fixtures.mediumSnapshot),
    ),
    runBudgetedBenchmark(
      budgets,
      "document_to_markdown",
      200,
      () => void serializeDocument(fixtures.longSnapshot),
    ),
    runBudgetedBenchmark(
      budgets,
      "document_to_markdown_rich",
      200,
      () => void serializeDocument(fixtures.richMixedSnapshot),
    ),
  ];
}
