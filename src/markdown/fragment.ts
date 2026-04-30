// Markdown ↔ Fragment bridge. Mirrors `serializer.ts` / `parser/index.ts`
// at the fragment altitude — no front matter, no comment threads, no
// trailing newline.
//
// The `Fragment` type lives in the document subsystem alongside `Block`
// and `Document`; this file owns only the markdown-text adaptation. The
// classification is the same on both sides — `parseFragment` and
// `extractFragment` both narrow to the lowest variant the payload's
// shape allows so paste can take the most precise path on the way back.

import { isPlainTextBlocks, type Fragment } from "@/document";
import { parseDocument } from "./parser";
import { serializeBlocks, serializeInlines } from "./serializer";

// Parses clipboard markdown, classifying the result for paste routing:
//   - Plain text (single unmarked paragraph) → `text`, the inline-replace
//     fast path.
//   - Marked inlines (single paragraph with marks/links/images/breaks) →
//     `inlines`, an in-leaf inline splice.
//   - Anything richer → `blocks`, the structural seam-merge.
export function parseFragment(source: string): Fragment {
  if (source.length === 0) {
    return { kind: "text", text: "" };
  }

  const { blocks } = parseDocument(source);

  if (isPlainTextBlocks(blocks)) {
    return { kind: "text", text: blocks[0]?.plainText ?? "" };
  }

  if (blocks.length === 1 && blocks[0]?.type === "paragraph") {
    return { kind: "inlines", inlines: blocks[0].children };
  }

  return { kind: "blocks", blocks };
}

// Serializes a fragment back to its markdown source. Each variant uses the
// matching primitive from `serializer.ts`; no extra wrapping.
export function serializeFragment(fragment: Fragment): string {
  switch (fragment.kind) {
    case "text":
      return fragment.text;
    case "inlines":
      return serializeInlines(fragment.inlines);
    case "blocks":
      return serializeBlocks(fragment.blocks);
  }
}
