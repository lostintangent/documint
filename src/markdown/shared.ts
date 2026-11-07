import { markOrder, type Mark, type MentionTarget } from "@/document";

export type MarkdownOptions = {
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
export const containerDirectiveClosingMarker = ":::";

// --- Inline mark spec ---
//
// Single source of truth for Documint markdown's mark syntax. One row per
// supported `Mark`, carrying both parser and serializer policy:
//
//   - `delimiter` rows parse the first matching closing delimiter. Their
//     contents are parsed as inline markdown unless `content` is `literal`,
//     which uses variable-width delimiter fencing so the authored text stays
//     unparsed.
//   - `emphasis` rows are CommonMark emphasis, read from `*` and `_` runs by
//     the delimiter-run algorithm. The serializer writes their `delimiter`,
//     or their tag where that delimiter can't open or close.
//   - `html` rows parse exact HTML tag pairs.
//   - the first tag is the canonical serializer form.
type InlineMarkSyntax =
  | { kind: "delimiter"; content: "inlines" | "literal"; delimiter: string }
  | { kind: "emphasis"; delimiter: string; tags: readonly [string, ...string[]] }
  | { kind: "html"; tags: readonly [string, ...string[]] };

export const inlineMarkSyntaxByMark: Record<Mark, InlineMarkSyntax> = {
  code: { kind: "delimiter", content: "literal", delimiter: "`" },
  bold: { kind: "emphasis", delimiter: "**", tags: ["strong"] },
  italic: { kind: "emphasis", delimiter: "*", tags: ["em"] },
  strikethrough: { kind: "delimiter", content: "inlines", delimiter: "~~" },
  underline: { kind: "html", tags: ["ins", "u"] },
  superscript: { kind: "html", tags: ["sup"] },
};

export const inlineMarkSpecs = markOrder.map((mark) => ({ mark, ...inlineMarkSyntaxByMark[mark] }));

// --- Emphasis flanking ---
//
// The serializer writes emphasis with `*` only, so the canonical form binds
// inside words. Both sides share CommonMark's flanking rules, which lets the
// serializer prove locally that each `*` run it writes reparses as intended.

const unicodeWhitespace = /\s/u;
const unicodePunctuation = /[\p{P}\p{S}]/u;

// `before` and `after` are the code points around the run, or "" at the edge
// of the inline source, which counts as whitespace.
export function resolveEmphasisFlanking(character: string, before: string, after: string) {
  const beforeKind = classifyCharacter(before);
  const afterKind = classifyCharacter(after);
  const left =
    afterKind !== "whitespace" && (afterKind !== "punctuation" || beforeKind !== "other");
  const right =
    beforeKind !== "whitespace" && (beforeKind !== "punctuation" || afterKind !== "other");

  // `_` can't open or close inside a word.
  return character === "_"
    ? {
        canOpen: left && (!right || beforeKind === "punctuation"),
        canClose: right && (!left || afterKind === "punctuation"),
      }
    : { canOpen: left, canClose: right };
}

function classifyCharacter(character: string) {
  if (character === "" || unicodeWhitespace.test(character)) {
    return "whitespace";
  }

  return unicodePunctuation.test(character) ? "punctuation" : "other";
}

export function codePointBefore(value: string, index: number) {
  const low = value.charCodeAt(index - 1);
  const start = low >= 0xdc00 && low <= 0xdfff && index >= 2 ? index - 2 : index - 1;
  return start < 0 ? "" : value.slice(start, index);
}

export function codePointAt(value: string, index: number) {
  const codePoint = value.codePointAt(index);
  return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
}

/**
 * Name of the trailing container directive that carries persisted comment
 * threads. The wire format is:
 *
 * ```
 * :::documint-comments
 * [
 *   { "anchor": {...}, "comments": [...], "quote": "...", "resolvedAt": "..." }
 * ]
 * :::
 * ```
 *
 * The body is a JSON array of `CommentThread`-shaped objects (see
 * `src/document/comments`). Runtime-only fields (`id`) are stripped on emit
 * and re-derived on parse from the thread's anchor + first-comment timestamp,
 * so persisted markdown stays stable across sessions. An anchor whose quote
 * and context appear more than once saves an `occurrence` (1-based) naming
 * which copy it sits on, and the parser drops one that isn't a positive
 * integer.
 */
export const commentDirectiveName = "documint-comments";
