import { markOrder, type Mark } from "@/document";
import { normalizeResourceProtocol, resolveRegisteredResourceProtocol } from "@/resources";

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
  resourceProtocols?: Iterable<string>;
};

export const lineFeed = "\n";

export const blockquoteMarker = ">";
export const fencedCodeMarker = "```";
export const containerDirectiveClosingMarker = ":::";

const emptyResourceProtocols: ReadonlySet<string> = new Set();

export function normalizeResourceProtocols(
  protocols: Iterable<string> | undefined,
): ReadonlySet<string> {
  if (!protocols) {
    return emptyResourceProtocols;
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

export function resolveRegisteredMarkdownResourceProtocol(
  url: string,
  protocols: ReadonlySet<string>,
) {
  return resolveRegisteredResourceProtocol(url, protocols);
}

// --- Inline mark spec ---
//
// Single source of truth for Documint markdown's mark syntax. One row per
// supported `Mark`, carrying both parser and serializer policy:
//
//   - `delimiter` specs parse paired markdown delimiters and emit their
//     canonical opening/closing delimiter.
//   - `html` specs parse exact HTML tag pairs and emit those same tags.
//   - `requireWordBoundary` — when true, the parser only accepts the
//     delimiter when neither side touches a word character. Models the
//     asymmetry between asterisk-italic (matches mid-word) and
//     underscore-italic (must sit on word boundaries).
//
// The parser derives delimiter and HTML-tag dispatch tables at module load.
// The serializer derives a per-`Mark` emit table from the same specs. Adding
// a mark with existing syntax families should be a single row here.
export type InlineMarkDelimiter = {
  delimiter: string;
  requireWordBoundary: boolean;
};

export type DelimitedInlineMarkSpecInput = {
  kind: "delimiter";
  emit: readonly [open: string, close: string];
  delimiters: ReadonlyArray<InlineMarkDelimiter>;
};

export type HtmlInlineMarkSpecInput = {
  kind: "html";
  openTag: string;
  closeTag: string;
};

export type InlineMarkSpecInput = DelimitedInlineMarkSpecInput | HtmlInlineMarkSpecInput;
export type DelimitedInlineMarkSpec = DelimitedInlineMarkSpecInput & { mark: Mark };
export type HtmlInlineMarkSpec = HtmlInlineMarkSpecInput & { mark: Mark };
export type InlineMarkSpec = DelimitedInlineMarkSpec | HtmlInlineMarkSpec;

const inlineMarkSpecByMark = {
  bold: {
    kind: "delimiter",
    emit: ["**", "**"],
    delimiters: [{ delimiter: "**", requireWordBoundary: false }],
  },
  italic: {
    kind: "delimiter",
    emit: ["*", "*"],
    delimiters: [
      { delimiter: "*", requireWordBoundary: false },
      { delimiter: "_", requireWordBoundary: true },
    ],
  },
  strikethrough: {
    kind: "delimiter",
    emit: ["~~", "~~"],
    delimiters: [{ delimiter: "~~", requireWordBoundary: false }],
  },
  underline: {
    kind: "html",
    openTag: "<ins>",
    closeTag: "</ins>",
  },
  superscript: {
    kind: "html",
    openTag: "<sup>",
    closeTag: "</sup>",
  },
} satisfies Record<Mark, InlineMarkSpecInput>;

export const inlineMarkSpecs: ReadonlyArray<InlineMarkSpec> =
  defineInlineMarkSpecs(inlineMarkSpecByMark);

function defineInlineMarkSpecs(specs: Record<Mark, InlineMarkSpecInput>): InlineMarkSpec[] {
  return markOrder.map((mark) => ({
    ...specs[mark],
    mark,
  }));
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
