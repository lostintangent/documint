import { isReferenceInlineNode, type Inline, type Link } from "@/document";

// U+FFFC OBJECT REPLACEMENT CHARACTER. Reference inlines occupy one editor
// selection offset so caret motion and range editing treat them as atoms.
export const INLINE_OBJECT_REPLACEMENT_TEXT = "\uFFFC";

export type InlineNodeWithEditorRange = {
  end: number;
  node: Inline;
  start: number;
};

export function editorInlineText(node: Exclude<Inline, Link>): string {
  if (isReferenceInlineNode(node)) {
    return INLINE_OBJECT_REPLACEMENT_TEXT;
  }

  switch (node.type) {
    case "text":
      return node.text;
    case "lineBreak":
      return "\n";
    case "raw":
      return node.source;
  }
}

export function editorInlineTextLength(node: Inline): number {
  return node.type === "link"
    ? node.children.reduce((sum, child) => sum + editorInlineTextLength(child), 0)
    : editorInlineText(node).length;
}

// Annotates the direct source inline nodes in `nodes` with editor-coordinate
// ranges. Link wrappers keep their node identity while contributing the
// recursive editor length of their children; this is not the flattened
// `IndexedInline` leaf view.
export function* inlineNodesWithEditorRanges(
  nodes: readonly Inline[],
): Iterable<InlineNodeWithEditorRange> {
  let cursor = 0;

  for (const node of nodes) {
    const start = cursor;
    const end = start + editorInlineTextLength(node);
    cursor = end;
    yield { end, node, start };
  }
}
