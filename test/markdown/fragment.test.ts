// Asserts on `parseFragment` / `serializeFragment`. Persistence-only concerns
// — leading front matter, the trailing `documint-comments` directive — must
// not leak into the fragment classifier.

import { describe, expect, test } from "bun:test";
import type { Fragment } from "@/document";
import { parseFragment, serializeFragment } from "@/markdown";

const fragmentSerializeCases: Array<[label: string, fragment: Fragment, expected: string]> = [
  ["text", { kind: "text", text: "hello" }, "hello"],
  ["inlines", parseFragment("*hello*\n"), "*hello*"],
  ["empty blocks", { kind: "blocks", blocks: [] }, ""],
];

describe("parseFragment classification", () => {
  // Each payload is narrowed to the lowest variant that losslessly fits it,
  // so a copy/paste round trip lands in the same fragment kind on the way
  // back. Ordered text → inlines → blocks (lowest to highest altitude).
  test.each([
    ["empty source", "text", ""],
    ["single unmarked paragraph", "text", "hello world\n"],
    ["single paragraph with marks", "inlines", "*italic* text\n"],
    ["multiple blocks", "blocks", "# Heading\n\nParagraph.\n"],
  ] as const)("classifies %s as `%s`", (_label, expectedKind, source) => {
    expect(parseFragment(source).kind).toBe(expectedKind);
  });

  test("uses markdown options when classifying inline content", () => {
    const fragment = parseFragment("[Recording](demo-resource://recording/live)\n", {
      resourceProtocols: ["demo-resource:"],
    });

    expect(fragment.kind).toBe("inlines");
    if (fragment.kind === "inlines") {
      expect(fragment.inlines).toHaveLength(1);
      expect(fragment.inlines[0]?.type).toBe("resource");
    }
  });

  test("resolves reference links against definitions within the fragment", () => {
    const fragment = parseFragment("See [docs][d].\n\n[d]: /docs\n");

    expect(fragment.kind).toBe("inlines");
    if (fragment.kind === "inlines") {
      expect(fragment.inlines[1]).toMatchObject({ type: "link", url: "/docs" });
    }
  });

  test("falls back to the pasted text when definitions use up the source", () => {
    expect(parseFragment("[1]: https://x.dev\n")).toEqual({
      kind: "text",
      text: "[1]: https://x.dev",
    });
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
      expect(serializeFragment(fragment)).toBe("---\n\n## foo: 1\n\nBody.");
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
  test.each(fragmentSerializeCases)(
    "emits %s fragments with no wrapping",
    (_label, fragment, expected) => {
      expect(serializeFragment(fragment)).toBe(expected);
    },
  );
});
