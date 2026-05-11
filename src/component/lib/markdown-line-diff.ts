import type { Block, Document } from "@/document";
import { serializeFragment } from "@/markdown";
import type { TextRangeTarget } from "@/editor";
import type { EditorStateTransition } from "../store/editor/transitions";

export type MarkdownLineDiff = {
  lineMarkdown: string;
  lineNumber: number;
};

export function resolveMarkdownLineDiff(
  transition: EditorStateTransition,
  target: TextRangeTarget,
): MarkdownLineDiff | null {
  const previousRegion = transition.previous.documentIndex.regionIndex.get(target.regionId);

  if (!previousRegion) {
    return null;
  }

  const nextRegion = transition.next.documentIndex.regionPathIndex.get(previousRegion.path);

  if (!nextRegion) {
    return null;
  }

  const previousDocument = transition.previous.documentIndex.document;
  const nextDocument = transition.next.documentIndex.document;
  const previousRoot = previousDocument.blocks[previousRegion.rootIndex];
  const nextRoot = nextDocument.blocks[nextRegion.rootIndex];

  if (!previousRoot || !nextRoot) {
    return null;
  }

  const changedLine = resolveFirstChangedFragmentLine(previousRoot, nextRoot);

  if (!changedLine) {
    return null;
  }

  return {
    lineMarkdown: changedLine.lineMarkdown,
    lineNumber: resolveRootStartLine(nextDocument, nextRegion.rootIndex) + changedLine.lineIndex,
  };
}

function resolveFirstChangedFragmentLine(previousRoot: Block, nextRoot: Block) {
  const previousMarkdown = serializeRoot(previousRoot);
  const nextMarkdown = serializeRoot(nextRoot);
  const changedIndex = findFirstChangedIndex(previousMarkdown, nextMarkdown);

  if (changedIndex === null) {
    return null;
  }

  const lineStart = nextMarkdown.lastIndexOf("\n", Math.max(0, changedIndex - 1)) + 1;
  const lineEnd = nextMarkdown.indexOf("\n", changedIndex);

  return {
    lineIndex: countLineFeeds(nextMarkdown, lineStart),
    lineMarkdown: nextMarkdown.slice(lineStart, lineEnd === -1 ? nextMarkdown.length : lineEnd),
  };
}

function resolveRootStartLine(document: Document, rootIndex: number) {
  let lineNumber = 1;

  if (document.frontMatter !== undefined) {
    lineNumber += countLineFeeds(document.frontMatter, document.frontMatter.length) + 2;
  }

  if (rootIndex > 0) {
    const previousBlocks = serializeFragment({
      kind: "blocks",
      blocks: document.blocks.slice(0, rootIndex),
    });

    if (previousBlocks.length > 0) {
      lineNumber += countLineFeeds(previousBlocks, previousBlocks.length) + 2;
    }
  }

  return lineNumber;
}

function serializeRoot(root: Block) {
  return serializeFragment({ kind: "blocks", blocks: [root] });
}

function findFirstChangedIndex(previous: string, next: string) {
  const end = Math.min(previous.length, next.length);

  for (let index = 0; index < end; index += 1) {
    if (previous[index] !== next[index]) {
      return index;
    }
  }

  return previous.length === next.length ? null : end;
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
