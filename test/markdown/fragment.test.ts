// Asserts on `parseFragment` / `serializeFragment`. Persistence-only concerns
// — leading front matter, the trailing `documint-comments` directive — must
// not leak into the fragment classifier.

import { describe, expect, test } from "bun:test";
import { parseFragment, serializeFragment } from "@/markdown";

describe("parseFragment classification", () => {
  // Each payload is narrowed to the lowest variant that losslessly fits it,
  // so a copy/paste round trip lands in the same fragment kind on the way
  // back. Ordered text → inlines → blocks (lowest to highest altitude).
  test.each([
    ["empty source", "", "text"],
    ["single unmarked paragraph", "hello world\n", "text"],
    ["single paragraph with marks", "*italic* text\n", "inlines"],
    ["multiple blocks", "# Heading\n\nParagraph.\n", "blocks"],
  ] as const)("classifies %s as `%s`", (_label, source, expectedKind) => {
    expect(parseFragment(source).kind).toBe(expectedKind);
  });
});

describe("parseFragment persistence-boundary isolation", () => {
  test("treats a leading `---` as a divider, not stripped front matter", () => {
    // Clipboard payloads are not a persistence boundary. The leading `---`
    // must survive as a thematic break instead of being silently consumed
    // as YAML front matter.
    const fragment = parseFragment("---\nfoo: 1\n---\n\nBody.\n");

    expect(fragment.kind).toBe("blocks");
    if (fragment.kind === "blocks") {
      expect(fragment.blocks[0]?.type).toBe("divider");
    }
  });

  test("preserves a trailing `documint-comments` directive as a content block", () => {
    // The comment-thread appendix is a markdown-only persistence concern.
    // On the fragment surface the directive must remain as a directive
    // block so paste sees the same bytes the user copied.
    const fragment = parseFragment(":::documint-comments\n[]\n:::\n");

    expect(fragment.kind).toBe("blocks");
    if (fragment.kind === "blocks") {
      expect(fragment.blocks).toHaveLength(1);
      expect(fragment.blocks[0]?.type).toBe("directive");
    }
  });
});

describe("serializeFragment", () => {
  test("emits each fragment variant with no wrapping", () => {
    expect(serializeFragment({ kind: "text", text: "hello" })).toBe("hello");
    expect(serializeFragment({ kind: "blocks", blocks: [] })).toBe("");
  });

  test("round-trips a fragment with a leading divider without absorbing it", () => {
    const source = "---\n\nBody.";
    const fragment = parseFragment(source);
    expect(serializeFragment(fragment)).toBe(source);
  });
});
