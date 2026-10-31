import { markOrder, normalizeResourceProtocol, type Mark, type MentionTarget } from "@/document";

export type MarkdownOptions = {
  /**
   * Parser knob. When `true`, the authored start number of an ordered list
   * (e.g. `3.` in `3. alpha\n3. beta`) is captured on `ListBlock.start` and
   * re-emitted verbatim by the serializer. When `false` (default), the list
   * canonicalizes to a start of `1`.
   */
  preserveOrderedListStart?: boolean;
  /**
   * Serializer knob. When `true`, every table cell is padded with trailing
   * (or leading, for right-aligned columns) spaces so cells align to the
   * widest value in their column. When `false` (default), cells emit at
   * their natural width — smaller diffs, no padding noise.
   */
  padTableColumns?: boolean;
  /**
   * Parser knob. Links whose URL protocol appears in this collection parse as
   * semantic resource inlines instead of ordinary editable links.
   * Serialization always emits resources back as standard markdown links.
   */
  resourceProtocols?: readonly string[];
  /**
   * Parser knob. Bare `@Name` text that exactly matches one of these targets
   * parses as a semantic mention inline. Canonical `@[Name](user-id)` mention
   * syntax is always supported; this option exists for host-authored surfaces
   * like comments that already have a mention roster.
   */
  mentionTargets?: readonly MentionTarget[];
};

export const lineFeed = "\n";

export const blockquoteMarker = ">";
export const fencedCodeMarker = "```";
export const containerDirectiveClosingMarker = ":::";

// --- Inline mark spec ---
//
// Single source of truth for Documint markdown's mark syntax. One row per
// supported `Mark`, carrying both parser and serializer policy:
//
//   - `delimiter` rows parse paired markdown delimiters. Their contents are
//     parsed as inline markdown unless `content` is `literal`, which uses
//     variable-width delimiter fencing so the authored text stays unparsed.
//   - `html` rows parse exact HTML tag pairs.
//   - the first delimiter or tag is the canonical serializer form.
//   - a delimiter with `boundary: "word"` binds only at word boundaries. This
//     captures the asymmetry between asterisk-italic (binds anywhere) and
//     underscore-italic.
export type InlineMarkContentPolicy = "inlines" | "literal";

export type InlineMarkDelimiter = {
  boundary?: "word";
  delimiter: string;
};

type InlineMarkSyntax =
  | {
      kind: "delimiter";
      content: InlineMarkContentPolicy;
      delimiters: readonly [InlineMarkDelimiter, ...InlineMarkDelimiter[]];
    }
  | {
      kind: "html";
      tags: readonly [string, ...string[]];
    };

export type InlineMarkSpec = InlineMarkSyntax & { mark: Mark };
export type DelimitedInlineMarkSpec = Extract<InlineMarkSpec, { kind: "delimiter" }>;
export type HtmlInlineMarkSpec = Extract<InlineMarkSpec, { kind: "html" }>;

const inlineMarkSyntaxByMark: Record<Mark, InlineMarkSyntax> = {
  code: { kind: "delimiter", content: "literal", delimiters: [{ delimiter: "`" }] },
  bold: { kind: "delimiter", content: "inlines", delimiters: [{ delimiter: "**" }] },
  italic: {
    kind: "delimiter",
    content: "inlines",
    delimiters: [{ delimiter: "*" }, { boundary: "word", delimiter: "_" }],
  },
  strikethrough: { kind: "delimiter", content: "inlines", delimiters: [{ delimiter: "~~" }] },
  underline: { kind: "html", tags: ["ins", "u"] },
  superscript: { kind: "html", tags: ["sup"] },
};

export const inlineMarkSpecs: ReadonlyArray<InlineMarkSpec> = markOrder.map((mark) => ({
  mark,
  ...inlineMarkSyntaxByMark[mark],
}));

/**
 * Name of the trailing container directive that carries persisted comment
 * threads. The wire format is:
 *
 * ```
 * :::documint-comments
 * [
 *   { "anchor": {...}, "comments": [...], "quote": "...", "resolution": ... }
 * ]
 * :::
 * ```
 *
 * The body is a JSON array of `CommentThread`-shaped objects (see
 * `src/document/comments`). Runtime-only fields (`id`) are stripped on emit
 * and re-derived on parse from the thread's anchor + first-comment timestamp,
 * so persisted markdown stays stable across sessions.
 */
export const commentDirectiveName = "documint-comments";

// --- Resource protocol normalization ---//

export function normalizeResourceProtocols(
  protocols: readonly string[] | undefined,
): ReadonlySet<string> | null {
  if (!protocols?.length) {
    return null;
  }

  const normalized = new Set<string>();
  for (const protocol of protocols) {
    const canonicalProtocol = normalizeResourceProtocol(protocol);

    if (canonicalProtocol) {
      normalized.add(canonicalProtocol);
    }
  }

  return normalized;
}
