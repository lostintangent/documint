import { parseDocument, serializeDocument } from "@/markdown";
import type { BenchmarkBudgetTree, BenchmarkRecord } from "./shared";
import { runBenchmark } from "./shared";

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
    runBenchmark(
      "markdown_to_document_comments",
      50,
      budgets.markdown_to_document_comments,
      () => void parseDocument(fixtures.commentsMarkdown),
    ),
    runBenchmark(
      "markdown_to_document_short",
      50,
      budgets.markdown_to_document_short,
      () => void parseDocument(fixtures.sampleMarkdown),
    ),
    runBenchmark(
      "markdown_to_document_medium",
      50,
      budgets.markdown_to_document_medium,
      () => void parseDocument(fixtures.mediumMarkdown),
    ),
    runBenchmark(
      "markdown_to_document",
      20,
      budgets.markdown_to_document,
      () => void parseDocument(fixtures.longMarkdown),
    ),
    runBenchmark(
      "markdown_to_document_rich",
      50,
      budgets.markdown_to_document_rich,
      () => void parseDocument(fixtures.richMixedMarkdown),
    ),
    runBenchmark(
      "document_to_markdown_comments",
      50,
      budgets.document_to_markdown_comments,
      () => void serializeDocument(fixtures.commentsSnapshot),
    ),
    runBenchmark(
      "document_to_markdown_short",
      50,
      budgets.document_to_markdown_short,
      () => void serializeDocument(fixtures.sampleSnapshot),
    ),
    runBenchmark(
      "document_to_markdown_medium",
      50,
      budgets.document_to_markdown_medium,
      () => void serializeDocument(fixtures.mediumSnapshot),
    ),
    runBenchmark(
      "document_to_markdown",
      50,
      budgets.document_to_markdown,
      () => void serializeDocument(fixtures.longSnapshot),
    ),
    runBenchmark(
      "document_to_markdown_rich",
      50,
      budgets.document_to_markdown_rich,
      () => void serializeDocument(fixtures.richMixedSnapshot),
    ),
  ];
}
