// Shared markdown line primitives for sync helpers. These functions operate on
// canonical markdown strings and root fragments, not editor selection state.
import type { Block, Document } from "@/document";
import { serializeFragment } from "@/markdown";

export type MarkdownLineReplacement = {
  nextText: string;
  startLine: number;
  endLine: number;
};

export function serializeRootMarkdown(root: Block) {
  return serializeFragment({ kind: "blocks", blocks: [root] });
}

export function countLineFeeds(value: string, end: number) {
  let count = 0;

  for (let index = 0; index < end; index += 1) {
    if (value[index] === "\n") {
      count += 1;
    }
  }

  return count;
}

export function resolveRootStartLine(document: Document, rootIndex: number) {
  let lineNumber = 0;

  if (document.frontMatter !== undefined) {
    lineNumber += countLineFeeds(document.frontMatter, document.frontMatter.length) + 2;
  }

  if (rootIndex > 0) {
    for (let index = 0; index < rootIndex; index += 1) {
      const block = document.blocks[index];

      if (block) {
        lineNumber += countRootMarkdownLines(block) + 1;
      }
    }
  }

  return lineNumber;
}

export function resolveRootEndLine(document: Document, rootIndex: number) {
  const root = document.blocks[rootIndex];

  return root ? resolveRootStartLine(document, rootIndex) + countRootMarkdownLines(root) : null;
}

export function resolveMarkdownLineReplacement(
  previousMarkdown: string,
  nextMarkdown: string,
): MarkdownLineReplacement | null {
  if (previousMarkdown === nextMarkdown) {
    return null;
  }

  const prefixLength = findCommonPrefixLength(previousMarkdown, nextMarkdown);

  if (prefixLength === previousMarkdown.length && nextMarkdown[prefixLength] === "\n") {
    const lineCount = countMarkdownLines(previousMarkdown);

    return {
      endLine: lineCount,
      nextText: nextMarkdown.slice(prefixLength + 1),
      startLine: lineCount,
    };
  }

  if (prefixLength === nextMarkdown.length && previousMarkdown[prefixLength] === "\n") {
    return {
      endLine: countMarkdownLines(previousMarkdown),
      nextText: "",
      startLine: countMarkdownLines(nextMarkdown),
    };
  }

  const previousLineStart = findLineStart(previousMarkdown, prefixLength);
  const nextLineStart = findLineStart(nextMarkdown, prefixLength);
  const suffixLength = findCommonSuffixLength(
    previousMarkdown,
    nextMarkdown,
    previousLineStart,
    nextLineStart,
  );
  const previousDiffEnd = previousMarkdown.length - suffixLength;
  const nextDiffEnd = nextMarkdown.length - suffixLength;
  const previousLineEnd = findReplacementLineEnd(
    previousMarkdown,
    previousLineStart,
    previousDiffEnd,
  );
  const nextLineEnd = findReplacementTextEnd(nextMarkdown, nextLineStart, nextDiffEnd);
  const startLine = countLineFeeds(previousMarkdown, previousLineStart);

  return {
    startLine,
    endLine:
      previousLineEnd === previousLineStart
        ? startLine
        : countLineFeeds(previousMarkdown, previousLineEnd) + 1,
    nextText: nextMarkdown.slice(nextLineStart, nextLineEnd),
  };
}

function findCommonPrefixLength(left: string, right: string) {
  const end = Math.min(left.length, right.length);

  for (let index = 0; index < end; index += 1) {
    if (left[index] !== right[index]) {
      return index;
    }
  }

  return end;
}

function findCommonSuffixLength(
  left: string,
  right: string,
  leftStart: number,
  rightStart: number,
) {
  const maxLength = Math.min(left.length - leftStart, right.length - rightStart);

  for (let length = 0; length < maxLength; length += 1) {
    if (left[left.length - 1 - length] !== right[right.length - 1 - length]) {
      return length;
    }
  }

  return maxLength;
}

function findLineStart(markdown: string, index: number) {
  return markdown.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
}

function findLineEnd(markdown: string, index: number) {
  const lineEnd = markdown.indexOf("\n", index);
  return lineEnd === -1 ? markdown.length : lineEnd;
}

function findReplacementLineEnd(markdown: string, lineStart: number, diffEnd: number) {
  if (diffEnd <= lineStart) {
    return lineStart;
  }

  return markdown[diffEnd - 1] === "\n" ? diffEnd - 1 : findLineEnd(markdown, diffEnd);
}

function findReplacementTextEnd(markdown: string, lineStart: number, diffEnd: number) {
  if (diffEnd <= lineStart) {
    return lineStart;
  }

  return markdown[diffEnd - 1] === "\n" ? diffEnd - 1 : findLineEnd(markdown, diffEnd);
}

function countRootMarkdownLines(root: Block) {
  switch (root.type) {
    case "code":
      return countLineFeeds(root.source, root.source.length) + 3;
    case "divider":
    case "heading":
    case "paragraph":
      return 1;
    case "raw":
      return countMarkdownLines(root.source);
    case "table":
      return root.rows.length + 1;
    default:
      return countMarkdownLines(serializeRootMarkdown(root));
  }
}

export function countMarkdownLines(markdown: string) {
  return markdown.length === 0 ? 0 : countLineFeeds(markdown, markdown.length) + 1;
}
