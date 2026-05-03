// Markdown round-trip assertions. Document-shape inspection helpers live
// in `test/document/helpers.ts`.

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
