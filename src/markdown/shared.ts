import {
  markOrder,
  normalizeResourceProtocol,
  resolveRegisteredResourceProtocol as resolveRegisteredResourceProtocolFromUrl,
  type Mark,
  type MentionTarget,
} from "@/document";

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
//   - specs default to `delimiter`, which parses paired markdown delimiters.
//     Their contents are parsed as inline markdown unless `content` is
//     `literal`.
//   - the first delimiter is the canonical serializer form. Literal content
//     uses variable-width delimiter fencing so the authored text stays
//     unparsed.
//   - `html` specs parse exact HTML tag pairs and emit the first tag as the
//     canonical serializer form.
//   - delimiter `boundary` policies model where a delimiter may bind. This
//     captures the asymmetry between asterisk-italic (can bind at any
//     character) and underscore-italic (binds only at word boundaries).
//
// The input table stays terse; `inlineMarkSpecs` normalizes it at module load
// so parser and serializer consume concrete policy instead of re-resolving
// defaults and canonical forms.
export type InlineMarkDelimiter = {
  boundary?: "character" | "word";
  delimiter: string;
};

export type InlineMarkContentPolicy = "inlines" | "literal";
export type InlineMarkDelimiterInput = string | InlineMarkDelimiter;
export type InlineMarkDelimiterSet =
  | string
  | readonly [InlineMarkDelimiterInput, ...InlineMarkDelimiterInput[]];

export type DelimitedInlineMarkSpecInput = {
  kind?: "delimiter";
  content?: InlineMarkContentPolicy;
  delimiter: InlineMarkDelimiterSet;
};

export type HtmlInlineMarkSpecInput = {
  kind: "html";
  tag: string | readonly [string, ...string[]];
};

export type InlineMarkSpecInput = DelimitedInlineMarkSpecInput | HtmlInlineMarkSpecInput;
export type DelimitedInlineMarkSpec = {
  canonicalDelimiter: InlineMarkDelimiter;
  content: InlineMarkContentPolicy;
  delimiters: ReadonlyArray<InlineMarkDelimiter>;
  kind: "delimiter";
  mark: Mark;
};
export type HtmlInlineMarkSpec = {
  canonicalTag: string;
  kind: "html";
  mark: Mark;
  tags: ReadonlyArray<string>;
};
export type InlineMarkSpec = DelimitedInlineMarkSpec | HtmlInlineMarkSpec;

const inlineMarkSpecByMark = {
  code: {
    content: "literal",
    delimiter: "`",
  },
  bold: {
    delimiter: "**",
  },
  italic: {
    delimiter: ["*", { boundary: "word", delimiter: "_" }],
  },
  strikethrough: {
    delimiter: "~~",
  },
  underline: {
    kind: "html",
    tag: ["ins", "u"],
  },
  superscript: {
    kind: "html",
    tag: "sup",
  },
} satisfies Record<Mark, InlineMarkSpecInput>;

export const inlineMarkSpecs: ReadonlyArray<InlineMarkSpec> =
  defineInlineMarkSpecs(inlineMarkSpecByMark);

function defineInlineMarkSpecs(specs: Record<Mark, InlineMarkSpecInput>): InlineMarkSpec[] {
  return markOrder.map((mark) => defineInlineMarkSpec(mark, specs[mark]));
}

function defineInlineMarkSpec(mark: Mark, spec: InlineMarkSpecInput): InlineMarkSpec {
  if (spec.kind === "html") {
    const tags = resolveHtmlTags(spec);
    return {
      canonicalTag: tags[0],
      kind: "html",
      mark,
      tags,
    };
  }

  const delimiters = resolveDelimitedMarkDelimiters(spec);
  return {
    canonicalDelimiter: delimiters[0],
    content: spec.content ?? "inlines",
    delimiters,
    kind: "delimiter",
    mark,
  };
}

export function isDelimitedInlineMarkSpec(spec: InlineMarkSpec): spec is DelimitedInlineMarkSpec {
  return spec.kind === "delimiter";
}

export function isHtmlInlineMarkSpec(spec: InlineMarkSpec): spec is HtmlInlineMarkSpec {
  return spec.kind === "html";
}

function resolveInlineMarkDelimiter(delimiter: InlineMarkDelimiterInput): InlineMarkDelimiter {
  return typeof delimiter === "string" ? { delimiter } : delimiter;
}

function resolveDelimitedMarkDelimiters(
  spec: DelimitedInlineMarkSpecInput,
): ReadonlyArray<InlineMarkDelimiter> {
  return isInlineMarkDelimiterList(spec.delimiter)
    ? spec.delimiter.map(resolveInlineMarkDelimiter)
    : [resolveInlineMarkDelimiter(spec.delimiter)];
}

function resolveHtmlTags(spec: HtmlInlineMarkSpecInput): ReadonlyArray<string> {
  return typeof spec.tag === "string" ? [spec.tag] : spec.tag;
}

function isInlineMarkDelimiterList(
  delimiter: InlineMarkDelimiterSet,
): delimiter is readonly [InlineMarkDelimiterInput, ...InlineMarkDelimiterInput[]] {
  return typeof delimiter !== "string";
}

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

// --- Resource protocol normalization and resolution ---//

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

export function resolveResourceProtocol(url: string, protocols: ReadonlySet<string> | null) {
  return protocols ? resolveRegisteredResourceProtocolFromUrl(url, protocols) : null;
}
