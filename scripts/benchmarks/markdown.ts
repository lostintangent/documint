import {
  parseMarkdown,
  serializeMarkdown,
} from "@/markdown";
import type { BenchmarkBudgetTree, BenchmarkRecord } from "./shared";
import { runBenchmark } from "./shared";

export function createMarkdownBenchmarks(
  budgets: BenchmarkBudgetTree["markdown"],
  fixtures: {
    commentsMarkdown: string;
    commentsSnapshot: ReturnType<typeof parseMarkdown>;
    longMarkdown: string;
    mediumMarkdown: string;
    mediumSnapshot: ReturnType<typeof parseMarkdown>;
    richMixedMarkdown: string;
    richMixedSnapshot: ReturnType<typeof parseMarkdown>;
    sampleMarkdown: string;
    sampleSnapshot: ReturnType<typeof parseMarkdown>;
    longSnapshot: ReturnType<typeof parseMarkdown>;
  },
): BenchmarkRecord[] {
  return [
    runBenchmark(
      "markdown_to_document_comments",
      50,
      budgets.markdown_to_document_comments,
      () => void parseMarkdown(fixtures.commentsMarkdown),
    ),
    runBenchmark(
      "markdown_to_document_short",
      50,
      budgets.markdown_to_document_short,
      () => void parseMarkdown(fixtures.sampleMarkdown),
    ),
    runBenchmark(
      "markdown_to_document_medium",
      50,
      budgets.markdown_to_document_medium,
      () => void parseMarkdown(fixtures.mediumMarkdown),
    ),
    runBenchmark(
      "markdown_to_document",
      20,
      budgets.markdown_to_document,
      () => void parseMarkdown(fixtures.longMarkdown),
    ),
    runBenchmark(
      "markdown_to_document_rich",
      50,
      budgets.markdown_to_document_rich,
      () => void parseMarkdown(fixtures.richMixedMarkdown),
    ),
    runBenchmark(
      "document_to_markdown_comments",
      50,
      budgets.document_to_markdown_comments,
      () => void serializeMarkdown(fixtures.commentsSnapshot),
    ),
    runBenchmark(
      "document_to_markdown_short",
      50,
      budgets.document_to_markdown_short,
      () => void serializeMarkdown(fixtures.sampleSnapshot),
    ),
    runBenchmark(
      "document_to_markdown_medium",
      50,
      budgets.document_to_markdown_medium,
      () => void serializeMarkdown(fixtures.mediumSnapshot),
    ),
    runBenchmark(
      "document_to_markdown",
      50,
      budgets.document_to_markdown,
      () => void serializeMarkdown(fixtures.longSnapshot),
    ),
    runBenchmark(
      "document_to_markdown_rich",
      50,
      budgets.document_to_markdown_rich,
      () => void serializeMarkdown(fixtures.richMixedSnapshot),
    ),
  ];
}
