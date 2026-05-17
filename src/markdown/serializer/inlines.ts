/**
 * Serializes semantic inline nodes into the canonical Documint markdown
 * dialect. Used by the block serializers for every text-bearing block, by
 * table-cell serialization, and by the fragment bridge when the clipboard
 * payload is inline content.
 */

import { defragmentTextInlines, type Inline, type Mark } from "@/document";
import { inlineMarkSpecs } from "../shared";

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
    case "code":
      return serializeInlineCode(node.code);
    case "link":
      return serializeLink(node);
    case "text":
      return applyMarks(escapeMarkdownText(node.text, nextNode), node.marks);
    case "raw":
      return node.source;
  }
}

// Per-mark emit lookup derived from `inlineMarkSpecs` at module load. Seeded
// with every `Mark` key up front so V8 settles on a single stable hidden
// class — the property access in `applyMarks` then JITs to a constant-time
// inline-cached load, matching the switch it replaces. Seeding also makes
// the seed object the place TypeScript catches a new `Mark` union member:
// adding one breaks this declaration until a key is added.
const inlineMarkEmit: Record<Mark, readonly [string, string]> = {
  bold: ["", ""],
  italic: ["", ""],
  strikethrough: ["", ""],
  underline: ["", ""],
};
for (const spec of inlineMarkSpecs) {
  inlineMarkEmit[spec.mark] = spec.emit;
}

// Reduce wraps `marks[0]` innermost and the last mark outermost. The parser
// builds the `marks` array by appending each mark as it descends into a
// nested delimited range (`[...marks, spec.mark]` in `parseInlineRange`), so
// the outer-most delimiter in the source ends up first in the array. The
// reverse mapping here — first-in-array becomes innermost-on-emit — is what
// makes the round trip stable for nested marks like `***foo***`.
function applyMarks(value: string, marks: Mark[]) {
  if (marks.length === 0) {
    return value;
  }
  return marks.reduce((current, mark) => {
    const [open, close] = inlineMarkEmit[mark];
    return `${open}${current}${close}`;
  }, value);
}

function serializeInlineCode(value: string) {
  // Fast path: typical inline-code content has no embedded backticks, so a
  // single backtick suffices as the fence and no padding is needed. Skips
  // the full-string scan that the variable-fence-width code below performs.
  if (!value.includes("`")) {
    return `\`${value}\``;
  }

  let widestFence = 0;
  let currentFence = 0;

  for (const character of value) {
    if (character === "`") {
      currentFence += 1;

      if (currentFence > widestFence) {
        widestFence = currentFence;
      }

      continue;
    }

    currentFence = 0;
  }

  const fence = "`".repeat(widestFence + 1);
  const padded = value.startsWith("`") || value.endsWith("`") ? ` ${value} ` : value;
  return `${fence}${padded}${fence}`;
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

function serializeLink(node: Extract<Inline, { type: "link" }>) {
  return `[${serializeInlines(node.children)}]${serializeLinkDestination(node.url, node.title)}`;
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
