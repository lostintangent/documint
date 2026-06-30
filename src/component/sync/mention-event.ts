// Mention event payload helper. Maps an accepted mention replacement to the
// canonical markdown line the host reports to the embedder.
import type { Block, Document } from "@/document";
import type { TextRangeTarget } from "@/editor";
import { resolveIndexedBlockContainingPath } from "@/editor/state";
import { serializeBlocks } from "@/markdown";
import type { EditorStateTransition } from "@/component/store/editor/transitions";

export type MentionLineChange = {
  lineMarkdown: string;
  lineNumber: number;
};

export function resolveMentionLineChange(
  transition: EditorStateTransition,
  target: TextRangeTarget,
): MentionLineChange | null {
  const previousBlock = resolveIndexedBlockContainingPath(
    transition.previous.documentIndex,
    target.path,
  );

  if (!previousBlock) {
    return null;
  }

  const nextBlock = resolveIndexedBlockContainingPath(transition.next.documentIndex, target.path);

  if (!nextBlock) {
    return null;
  }

  const previousDocument = transition.previous.documentIndex.document;
  const nextDocument = transition.next.documentIndex.document;
  const previousRoot = previousDocument.blocks[previousBlock.rootIndex];
  const nextRoot = nextDocument.blocks[nextBlock.rootIndex];

  if (!previousRoot || !nextRoot) {
    return null;
  }

  const changedLine = resolveFirstChangedMarkdownLine(
    serializeBlocks([previousRoot]),
    serializeBlocks([nextRoot]),
  );

  if (!changedLine) {
    return null;
  }

  return {
    lineMarkdown: changedLine.lineMarkdown,
    lineNumber:
      resolveRootStartLine(nextDocument, nextBlock.rootIndex) + changedLine.lineIndex + 1,
  };
}

function resolveFirstChangedMarkdownLine(previousMarkdown: string, nextMarkdown: string) {
  if (previousMarkdown === nextMarkdown) {
    return null;
  }

  const prefixLength = findCommonPrefixLength(previousMarkdown, nextMarkdown);
  const nextLineStart = findLineStart(nextMarkdown, prefixLength);
  const nextLineEnd = findLineEnd(nextMarkdown, nextLineStart);
  const lineMarkdown = nextMarkdown.slice(nextLineStart, nextLineEnd);

  if (lineMarkdown.length === 0) {
    return null;
  }

  return {
    lineIndex: countLineFeeds(nextMarkdown, nextLineStart),
    lineMarkdown,
  };
}

function resolveRootStartLine(document: Document, rootIndex: number) {
  let lineNumber = 0;

  if (document.frontMatter !== undefined) {
    lineNumber += countLineFeeds(document.frontMatter, document.frontMatter.length) + 2;
  }

  for (let index = 0; index < rootIndex; index += 1) {
    const block = document.blocks[index];

    if (block) {
      lineNumber += countRootMarkdownLines(block) + 1;
    }
  }

  return lineNumber;
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
      return countMarkdownLines(serializeBlocks([root]));
  }
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

function findLineStart(markdown: string, index: number) {
  return markdown.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
}

function findLineEnd(markdown: string, index: number) {
  const lineEnd = markdown.indexOf("\n", index);
  return lineEnd === -1 ? markdown.length : lineEnd;
}

function countMarkdownLines(markdown: string) {
  return markdown.length === 0 ? 0 : countLineFeeds(markdown, markdown.length) + 1;
}

function countLineFeeds(value: string, end: number) {
  let count = 0;

  for (let index = 0; index < end; index += 1) {
    if (value[index] === "\n") {
      count += 1;
    }
  }

  return count;
}
