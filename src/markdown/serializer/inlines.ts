/**
 * Serializes semantic inline nodes into the canonical Documint markdown
 * dialect. Used by the block serializers for every text-bearing block, by
 * table-cell serialization, and by the fragment bridge when the clipboard
 * payload is inline content.
 */

import { defragmentTextInlines, type Inline, type Mark } from "@/document";
import { underlineCloseTag, underlineOpenTag } from "../shared";

// --- Escape patterns ---
// Mirror the inverse-escape patterns in `parser/inlines.ts`. The serializer
// escapes a deliberately narrower set than the parser unescapes — the parser
// is permissive about authored backslashes, but emission only needs to escape
// the characters that would otherwise flip the parse on the next round-trip.
const markdownTextEscapePattern = /([\\`*_[\]])/g;
const markdownDestinationEscapePattern = /([\\)&])/g;
const markdownTitleEscapePattern = /(["\\])/g;

export function serializeInlines(nodes: Inline[]): string {
  return defragmentTextInlines(nodes)
    .map((node) => serializeInline(node))
    .join("");
}

function serializeInline(node: Inline): string {
  switch (node.type) {
    case "lineBreak":
      // `<br>` is the only hard-break encoding that survives prettier,
      // trim-trailing-whitespace hooks, and table-cell rows (which must
      // stay single-line). We omit a trailing `\n`; the parser eats one
      // if present so authored `<br>\n` still round-trips cleanly.
      return "<br>";
    case "image":
      return serializeImage(node);
    case "code":
      return serializeInlineCode(node.code);
    case "link":
      return serializeLink(node);
    case "text":
      return applyMarks(escapeMarkdownText(node.text), node.marks);
    case "raw":
      return node.source;
  }
}

function applyMarks(value: string, marks: Mark[]) {
  return marks.reduce((current, mark) => {
    switch (mark) {
      case "bold":
        return `**${current}**`;
      case "italic":
        return `*${current}*`;
      case "strikethrough":
        return `~~${current}~~`;
      case "underline":
        return `${underlineOpenTag}${current}${underlineCloseTag}`;
    }
  }, value);
}

function serializeInlineCode(value: string) {
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

  const fenceWidth = widestFence > 0 ? widestFence + 1 : 1;
  const fence = "`".repeat(fenceWidth);
  const padded = value.startsWith("`") || value.endsWith("`") ? ` ${value} ` : value;
  return `${fence}${padded}${fence}`;
}

function serializeImage(node: Extract<Inline, { type: "image" }>) {
  const alt = escapeMarkdownText(node.alt ?? "");
  const destination = serializeLinkDestination(node.url, node.title);
  const width = node.width ? `{width=${node.width}}` : "";

  return `![${alt}]${destination}${width}`;
}

function serializeLink(node: Extract<Inline, { type: "link" }>) {
  return `[${serializeInlines(node.children)}]${serializeLinkDestination(node.url, node.title)}`;
}

function serializeLinkDestination(url: string, title: string | null) {
  return `(${escapeMarkdownDestination(url)}${serializeOptionalTitle(title)})`;
}

// --- Low-level utilities ---

function escapeMarkdownText(value: string) {
  return value.replace(markdownTextEscapePattern, "\\$1");
}

function escapeMarkdownDestination(value: string) {
  return value.replace(markdownDestinationEscapePattern, "\\$1");
}

function serializeOptionalTitle(title: string | null) {
  return title ? ` "${title.replace(markdownTitleEscapePattern, "\\$1")}"` : "";
}
