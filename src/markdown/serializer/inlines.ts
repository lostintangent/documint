/**
 * Serializes semantic inline nodes into the canonical Documint markdown
 * dialect. Used by the block serializers for every text-bearing block, by
 * table-cell serialization, and by the fragment bridge when the clipboard
 * payload is inline content.
 */

import { defragmentTextInlines, type Inline, type Mark } from "@/document";
import {
  inlineMarkSpecs,
  isDelimitedInlineMarkSpec,
  type DelimitedInlineMarkSpec,
  type HtmlInlineMarkSpec,
  type InlineMarkSpec,
} from "../shared";

// --- Escape patterns ---
// Mirror the inverse-escape patterns in `parser/inlines.ts`. The serializer
// escapes a deliberately narrower set than the parser unescapes — the parser
// is permissive about authored backslashes, but emission only needs to escape
// the characters that would otherwise flip the parse on the next round-trip.
const markdownTextEscapePattern = /([\\`*_[\]])/g;
const markdownDestinationEscapePattern = /([\\)&])/g;
const markdownTitleEscapePattern = /(["\\])/g;
// Fast-reject probe for text-node escape: if a string contains none of the
// markdown metacharacters (including `@` for mention defense), neither of
// the replaces in `escapeMarkdownText` would have anything to do — and
// plain prose, the dominant input, hits this case.
const markdownTextMetaProbe = /[\\`*_[\]@]/;

export function serializeInlines(nodes: Inline[]): string {
  const normalized = defragmentTextInlines(nodes);

  return normalized.map((node, index) => serializeInline(node, normalized[index + 1])).join("");
}

function serializeInline(node: Inline, nextNode?: Inline): string {
  switch (node.type) {
    case "lineBreak":
      // `<br>` is the only hard-break encoding that survives prettier,
      // trim-trailing-whitespace hooks, and table-cell rows (which must
      // stay single-line). We omit a trailing `\n`; the parser eats one
      // if present so authored `<br>\n` still round-trips cleanly.
      return "<br>";
    case "image":
      return serializeImage(node);
    case "mention":
      return serializeMention(node);
    case "resource":
      return serializeResource(node);
    case "link":
      return serializeLink(node);
    case "text":
      return serializeText(node, nextNode);
    case "raw":
      return node.source;
  }
}

// Per-mark emit lookup derived from the markdown-owned mark specs. Exhaustive
// coverage is enforced by `inlineMarkSpecByMark` in `shared.ts`; the
// serializer should not repeat one row per semantic mark.
const inlineMarkEmit = createInlineMarkEmit(inlineMarkSpecs);
const literalContentMarks = new Set(
  inlineMarkSpecs
    .filter(isDelimitedInlineMarkSpec)
    .filter((spec) => spec.content === "literal")
    .map((spec) => spec.mark),
);

// Reduce wraps `marks[0]` innermost and the last mark outermost. The parser
// builds the `marks` array by appending each mark as it descends into a
// nested delimited range (`[...marks, spec.mark]` in `parseInlineRange`), so
// the outer-most delimiter in the source ends up first in the array. The
// reverse mapping here — first-in-array becomes innermost-on-emit — is what
// makes the round trip stable for nested marks like `***foo***`.
function serializeText(node: Extract<Inline, { type: "text" }>, nextNode?: Inline) {
  const value = hasLiteralContentMark(node.marks)
    ? node.text
    : escapeMarkdownText(node.text, nextNode);
  return applyMarks(value, node.marks);
}

function applyMarks(value: string, marks: Mark[]) {
  if (marks.length === 0) {
    return value;
  }
  return marks.reduce((current, mark) => {
    return inlineMarkEmit[mark](current);
  }, value);
}

function hasLiteralContentMark(marks: readonly Mark[]) {
  return marks.some((mark) => literalContentMarks.has(mark));
}

type InlineMarkEmit = (value: string) => string;

function createInlineMarkEmit(specs: ReadonlyArray<InlineMarkSpec>): Record<Mark, InlineMarkEmit> {
  return Object.fromEntries(
    specs.map((spec) => {
      switch (spec.kind) {
        case "delimiter": {
          return [spec.mark, createDelimitedInlineMarkEmit(spec)];
        }
        case "html":
          return [spec.mark, createHtmlInlineMarkEmit(spec)];
      }
    }),
  ) as Record<Mark, InlineMarkEmit>;
}

function createHtmlInlineMarkEmit(spec: HtmlInlineMarkSpec): InlineMarkEmit {
  const tag = spec.canonicalTag;
  return (value) => `<${tag}>${value}</${tag}>`;
}

function createDelimitedInlineMarkEmit(spec: DelimitedInlineMarkSpec): InlineMarkEmit {
  const delimiter = spec.canonicalDelimiter.delimiter;

  if (spec.content === "literal") {
    return (value) => serializeLiteralDelimitedMark(value, delimiter);
  }

  return (value) => `${delimiter}${value}${delimiter}`;
}

function serializeLiteralDelimitedMark(value: string, marker: string) {
  if (!value.includes(marker)) {
    return `${marker}${value}${marker}`;
  }

  const fence = marker.repeat(findWidestMarkerRun(value, marker) + 1);
  const padded = value.startsWith(marker) || value.endsWith(marker) ? ` ${value} ` : value;
  return `${fence}${padded}${fence}`;
}

function findWidestMarkerRun(value: string, marker: string) {
  if (marker.length === 0) {
    return 0;
  }

  let widestRun = 0;
  let currentRun = 0;
  let index = 0;

  while (index < value.length) {
    if (value.startsWith(marker, index)) {
      currentRun += 1;
      widestRun = Math.max(widestRun, currentRun);
      index += marker.length;
      continue;
    }

    currentRun = 0;
    index += 1;
  }

  return widestRun;
}

function serializeImage(node: Extract<Inline, { type: "image" }>) {
  const alt = escapeMarkdownText(node.alt ?? "");
  const destination = serializeLinkDestination(node.url, node.title);
  const width = node.width ? `{width=${node.width}}` : "";

  return `![${alt}]${destination}${width}`;
}

function serializeMention(node: Extract<Inline, { type: "mention" }>) {
  return `@[${escapeMarkdownText(node.name)}](${escapeMarkdownDestination(node.userId)})`;
}

function serializeResource(node: Extract<Inline, { type: "resource" }>) {
  return serializeInlineLink(escapeMarkdownText(node.label), node.url, null);
}

function serializeLink(node: Extract<Inline, { type: "link" }>) {
  return serializeInlineLink(serializeInlines(node.children), node.url, node.title);
}

function serializeInlineLink(label: string, url: string, title: string | null) {
  return `[${label}]${serializeLinkDestination(url, title)}`;
}

function serializeLinkDestination(url: string, title: string | null) {
  return `(${escapeMarkdownDestination(url)}${serializeOptionalTitle(title)})`;
}

// --- Low-level utilities ---

function escapeMarkdownText(value: string, nextNode?: Inline) {
  // Fast-reject: plain prose contains none of the meta characters and
  // skipping both replaces is the biggest single per-keystroke win in
  // the serializer.
  if (!markdownTextMetaProbe.test(value)) {
    return value;
  }

  const escaped = value.replace(markdownTextEscapePattern, "\\$1").replace(/@(?=\[)/g, "\\@");
  return nextNode?.type === "link" && escaped.endsWith("@")
    ? `${escaped.slice(0, -1)}\\@`
    : escaped;
}

function escapeMarkdownDestination(value: string) {
  return value.replace(markdownDestinationEscapePattern, "\\$1");
}

function serializeOptionalTitle(title: string | null) {
  return title ? ` "${title.replace(markdownTitleEscapePattern, "\\$1")}"` : "";
}
