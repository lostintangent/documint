// Mention event payload helper. Maps an accepted mention replacement to the
// canonical markdown line the host reports to the embedder.
import type { TextRangeTarget } from "@/editor";
import type { EditorStateTransition } from "@/component/store/editor/transitions";
import {
  resolveMarkdownLineReplacement,
  resolveRootStartLine,
  serializeRootMarkdown,
} from "./markdown-lines";

export type MentionLineChange = {
  lineMarkdown: string;
  lineNumber: number;
};

export function resolveMentionLineChange(
  transition: EditorStateTransition,
  target: TextRangeTarget,
): MentionLineChange | null {
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

  const lineReplacement = resolveMarkdownLineReplacement(
    serializeRootMarkdown(previousRoot),
    serializeRootMarkdown(nextRoot),
  );

  if (!lineReplacement) {
    return null;
  }

  return {
    lineMarkdown: resolveFirstReplacementLine(lineReplacement.nextText),
    lineNumber:
      resolveRootStartLine(nextDocument, nextRegion.rootIndex) + lineReplacement.startLine + 1,
  };
}

function resolveFirstReplacementLine(text: string) {
  const lineEnd = text.indexOf("\n");
  return lineEnd === -1 ? text : text.slice(0, lineEnd);
}
