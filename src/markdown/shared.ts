import type { Mark } from "@/document";

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
};

export const lineFeed = "\n";

export const underlineOpenTag = "<ins>";
export const underlineCloseTag = "</ins>";

export const blockquoteMarker = ">";
export const fencedCodeMarker = "```";
export const containerDirectiveClosingMarker = ":::";

// --- Inline mark spec ---
//
// Single source of truth for the parser→serializer mark vocabulary. One row
// per `Mark`, carrying both how the serializer emits it and the (possibly
// empty) set of delimiter forms the parser recognizes:
//
//   - `emit`        — opening and closing strings the serializer wraps text
//     in. Always present (every Mark must round-trip).
//   - `delimiters`  — every authored delimiter that parses into this mark.
//     A mark with no `delimiters` (e.g. `underline`) is parsed by a
//     dedicated token reader instead of the shared delimited dispatch.
//   - `requireWordBoundary` — when true, the parser only accepts the
//     delimiter when neither side touches a word character. Models the
//     asymmetry between asterisk-italic (matches mid-word) and
//     underscore-italic (must sit on word boundaries).
//
// The parser derives a flat, length-desc-sorted lookup at module load so
// longer delimiters win over their shorter prefixes (`**` before `*`). The
// serializer derives a per-`Mark` emit table at module load. Adding a new
// mark is a single edit here — parser dispatch, paragraph escape, and
// serializer emission all pick it up automatically.
export type InlineMarkDelimiter = {
  delimiter: string;
  requireWordBoundary: boolean;
};

export type InlineMarkSpec = {
  mark: Mark;
  emit: readonly [open: string, close: string];
  delimiters: ReadonlyArray<InlineMarkDelimiter>;
};

export const inlineMarkSpecs: ReadonlyArray<InlineMarkSpec> = [
  {
    mark: "bold",
    emit: ["**", "**"],
    delimiters: [{ delimiter: "**", requireWordBoundary: false }],
  },
  {
    mark: "italic",
    emit: ["*", "*"],
    delimiters: [
      { delimiter: "*", requireWordBoundary: false },
      { delimiter: "_", requireWordBoundary: true },
    ],
  },
  {
    mark: "strikethrough",
    emit: ["~~", "~~"],
    delimiters: [{ delimiter: "~~", requireWordBoundary: false }],
  },
  {
    mark: "underline",
    emit: [underlineOpenTag, underlineCloseTag],
    // Parsed by `readUnderlineToken` (HTML-tag shape), not by the shared
    // delimited-mark dispatch. Listed here purely for the serializer's
    // emit lookup.
    delimiters: [],
  },
];

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
