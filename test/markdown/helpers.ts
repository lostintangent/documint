// Markdown round-trip assertions and shared fixtures. Document-shape
// inspection helpers live in `test/document/helpers.ts`.

import { expect } from "bun:test";
import { parseDocument, serializeDocument, type MarkdownOptions } from "@/markdown";

export function expectRoundTrip(source: string, options?: MarkdownOptions): void {
  expect(serializeDocument(parseDocument(source, options), options)).toBe(source);
}

// Canonical-form check plus reparse-stability check. After one round trip the
// output must equal `source`; after a second round trip it must still equal
// the first. Used for fixtures whose authored form is already canonical.
export function expectStableRoundTrip(source: string, options?: MarkdownOptions): void {
  const firstPass = serializeDocument(parseDocument(source, options), options);
  const secondPass = serializeDocument(parseDocument(firstPass, options), options);

  expect(firstPass).toBe(source);
  expect(secondPass).toBe(firstPass);
}

// For sources authored in a supported but non-canonical form: one save must
// produce `canonical`, which must itself round-trip stably.
export function expectCanonicalRoundTrip(
  source: string,
  canonical: string,
  options?: MarkdownOptions,
): void {
  expect(serializeDocument(parseDocument(source, options), options)).toBe(canonical);
  expectStableRoundTrip(canonical, options);
}

// A paragraph followed by a one-thread comment appendix. `thread` adds or
// overrides appendix fields, such as a persisted `id`.
export function commentedParagraphMarkdown(thread: Record<string, unknown> = {}): string {
  const appendix = [
    {
      anchor: { prefix: "Paragraph", suffix: " with a comment." },
      comments: [{ body: "Reviewing this.", updatedAt: "2026-04-05T12:00:00.000Z" }],
      quote: " with ",
      ...thread,
    },
  ];

  return `Paragraph with a comment.\n\n:::documint-comments\n${JSON.stringify(appendix, null, 2)}\n:::\n`;
}
