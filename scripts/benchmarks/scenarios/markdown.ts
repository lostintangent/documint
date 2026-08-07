import { parseDocument, serializeDocument } from "@/markdown";
import type { BenchmarkFixtures } from "../fixtures";
import type { BenchmarkScenario } from "../harness";
import { createBenchmarkScenario } from "../harness";

export function createMarkdownScenarios(fixtures: BenchmarkFixtures): BenchmarkScenario[] {
  const parseScenarios = [
    { id: "markdown_to_document_comments", iterations: 200, markdown: fixtures.commentsMarkdown },
    { id: "markdown_to_document_short", iterations: 200, markdown: fixtures.sampleMarkdown },
    { id: "markdown_to_document_medium", iterations: 200, markdown: fixtures.mediumMarkdown },
    { id: "markdown_to_document", iterations: 300, markdown: fixtures.longMarkdown },
    { id: "markdown_to_document_rich", iterations: 200, markdown: fixtures.richMixedMarkdown },
  ] as const;
  const serializeScenarios = [
    { id: "document_to_markdown_comments", iterations: 200, snapshot: fixtures.commentsSnapshot },
    { id: "document_to_markdown_short", iterations: 200, snapshot: fixtures.sampleSnapshot },
    { id: "document_to_markdown_medium", iterations: 200, snapshot: fixtures.mediumSnapshot },
    { id: "document_to_markdown", iterations: 200, snapshot: fixtures.longSnapshot },
    { id: "document_to_markdown_rich", iterations: 200, snapshot: fixtures.richMixedSnapshot },
  ] as const;

  return [
    ...parseScenarios.map(({ id, iterations, markdown }) =>
      createBenchmarkScenario("markdown", id, iterations, () => void parseDocument(markdown)),
    ),
    ...serializeScenarios.map(({ id, iterations, snapshot }) =>
      createBenchmarkScenario("markdown", id, iterations, () => void serializeDocument(snapshot)),
    ),
  ];
}
