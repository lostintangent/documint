// Mention event payload helper. Maps an accepted mention replacement to the
// canonical markdown line the host reports to the embedder.
import { serializeDocument } from "@/markdown";
import type { EditorStateTransition } from "@/component/store/editor/transitions";

// The mention is the transition's only edit, so the first line that differs
// between the two saved documents is the mention's line.
export function resolveMentionLineChange(transition: EditorStateTransition) {
  // No `padTableColumns`: a widened padded column would make its header row the first change.
  const previousMarkdown = serializeDocument(transition.previous.documentIndex.document);
  const nextMarkdown = serializeDocument(transition.next.documentIndex.document);
  const prefixLength = findCommonPrefixLength(previousMarkdown, nextMarkdown);
  const lineStart = nextMarkdown.lastIndexOf("\n", prefixLength - 1) + 1;

  return {
    lineMarkdown: nextMarkdown.slice(lineStart, nextMarkdown.indexOf("\n", lineStart)),
    lineNumber: nextMarkdown.slice(0, lineStart).split("\n").length,
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
