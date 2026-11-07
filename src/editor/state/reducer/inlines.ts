// Editor-inline manipulation: low-level primitives for slicing, replacing,
// and rebuilding IndexedInline arrays. Used by text replacement and fragment
// extraction to preserve inline semantics while editing indexed path text.
//
// IndexedInline is the runtime range map: each record references the source
// document Inline node directly (with Link wrappers flattened to an
// orthogonal `link` field), and carries pre-computed char-offset coordinates.
// These primitives operate on IndexedInline arrays and produce either new
// IndexedInline arrays or document-side Inline nodes ready to slot back into a
// Block. Inline text is derived from the node or owning editor text path; it is not
// duplicated here. Structured inline commands use
// commands/actions/inlines/shared.ts instead, where replacement payloads are
// still document `Inline[]` trees.

import {
  createLink as createDocumentLinkNode,
  createRaw as createDocumentUnsupportedInlineNode,
  createText as createDocumentTextNode,
  defragmentTextInlines,
  isReferenceInlineNode,
  type Inline,
  type Link,
} from "@/document";
import { indexedInlineText } from "../index/inlines";
import type { IndexedInline } from "../index/types";

type DraftEditorInline = Omit<IndexedInline, "end" | "start">;

type EditContext = {
  didInsert: boolean;
  replacementText: string;
};

/* Public entry points */

export function editIndexedInlines(
  inlines: readonly IndexedInline[],
  startOffset: number,
  endOffset: number,
  replacementText: string,
): Inline[] {
  return editorInlinesToDocumentInlines(
    replaceEditorInlines(inlines, startOffset, endOffset, replacementText),
  );
}

export function replaceEditorInlines(
  inlines: readonly IndexedInline[],
  startOffset: number,
  endOffset: number,
  replacementText: string,
) {
  const context: EditContext = {
    didInsert: false,
    replacementText,
  };
  const nextInlines = editEditorInlines(inlines, startOffset, endOffset, context);

  return finalizeEditorInlines(compactEditorInlines(nextInlines));
}

export function editorInlinesToDocumentInlines(inlines: readonly IndexedInline[]): Inline[] {
  const nodes: Inline[] = [];

  for (let index = 0; index < inlines.length; index += 1) {
    const inline = inlines[index]!;

    if (inline.link) {
      const children: Inline[] = [];
      const link = inline.link;

      while (index < inlines.length && sameLink(inlines[index]!.link, link)) {
        const child = editorInlineToDocumentInline(inlines[index]!);

        if (child) {
          children.push(child);
        }

        index += 1;
      }

      index -= 1;

      if (children.length > 0) {
        nodes.push(
          createDocumentLinkNode({
            children: defragmentTextInlines(children),
            title: link.title,
            url: link.url,
          }),
        );
      }

      continue;
    }

    const node = editorInlineToDocumentInline(inline);

    if (node) {
      nodes.push(node);
    }
  }

  return defragmentTextInlines(nodes);
}

/* Edit traversal */

function editEditorInlines(
  inlines: readonly IndexedInline[],
  startOffset: number,
  endOffset: number,
  context: EditContext,
): DraftEditorInline[] {
  const nextInlines: DraftEditorInline[] = [];

  for (const [index, inline] of inlines.entries()) {
    if (!context.didInsert && startOffset === endOffset && startOffset === inline.start) {
      pushGeneratedTextInline(
        nextInlines,
        context,
        resolveBoundaryLinkForInsertion(inlines[index - 1] ?? null, inline),
      );
    }

    if (endOffset <= inline.start || startOffset >= inline.end) {
      nextInlines.push(createDraftEditorInline(inline));
      continue;
    }

    const localStart = Math.max(0, startOffset - inline.start);
    const inlineText = indexedInlineText(inline);
    const localEnd = Math.min(inlineText.length, endOffset - inline.start);
    const replacement =
      !context.didInsert && context.replacementText.length > 0 ? context.replacementText : "";
    const nextForInline = replaceEditorInline(inline, localStart, localEnd, replacement, context);

    if (localStart !== localEnd || replacement.length > 0) {
      context.didInsert = true;
    }

    nextInlines.push(...nextForInline);
  }

  if (!context.didInsert) {
    pushGeneratedTextInline(
      nextInlines,
      context,
      resolveBoundaryLinkForInsertion(inlines.at(-1) ?? null, null),
    );
  }

  return nextInlines;
}

function replaceEditorInline(
  inline: IndexedInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  context: EditContext,
): DraftEditorInline[] {
  if (isReferenceInlineNode(inline.node)) {
    return replaceReferenceEditorInline(inline, startOffset, endOffset, replacementText);
  }

  switch (inline.node.type) {
    case "text":
    case "raw":
      return replaceTextLikeEditorInline(inline, startOffset, endOffset, replacementText);
    case "lineBreak":
      return replaceBreakEditorInline(inline, startOffset, endOffset, replacementText, context);
  }
}

function replaceTextLikeEditorInline(
  inline: IndexedInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): DraftEditorInline[] {
  const inlineText = indexedInlineText(inline);
  const nextText = inlineText.slice(0, startOffset) + replacementText + inlineText.slice(endOffset);

  return nextText.length > 0
    ? [
        {
          ...createDraftEditorInline(inline),
          node: replaceInlineNodeText(inline.node, nextText),
        },
      ]
    : [];
}

function replaceBreakEditorInline(
  inline: IndexedInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  context: EditContext,
): DraftEditorInline[] {
  if (startOffset === endOffset) {
    return [createDraftEditorInline(inline)];
  }

  const nextInlines: DraftEditorInline[] = [];

  if (replacementText.length > 0) {
    pushGeneratedTextInline(nextInlines, context, inline.link);
  }

  return nextInlines;
}

function replaceReferenceEditorInline(
  inline: IndexedInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): DraftEditorInline[] {
  if (startOffset === 0 && endOffset === indexedInlineText(inline).length) {
    return replacementText.length > 0
      ? [createGeneratedTextInline(replacementText, inline.link)]
      : [];
  }

  return [createDraftEditorInline(inline)];
}

/* Generated inlines and boundary resolution */

function pushGeneratedTextInline(
  inlines: DraftEditorInline[],
  context: EditContext,
  link: Link | null,
) {
  if (context.replacementText.length === 0) {
    context.didInsert = true;
    return;
  }

  inlines.push(createGeneratedTextInline(context.replacementText, link));
  context.didInsert = true;
}

function createGeneratedTextInline(text: string, link: Link | null): DraftEditorInline {
  return {
    link,
    node: createDocumentTextNode(text),
  };
}

function resolveBoundaryLinkForInsertion(
  previousInline: IndexedInline | null,
  nextInline: IndexedInline | null,
) {
  return previousInline?.link && nextInline?.link && sameLink(previousInline.link, nextInline.link)
    ? previousInline.link
    : null;
}

/* Draft compaction and finalization */

function createDraftEditorInline(inline: IndexedInline): DraftEditorInline {
  return {
    link: inline.link,
    node: inline.node,
  };
}

function finalizeEditorInlines(inlines: DraftEditorInline[]): IndexedInline[] {
  const finalized: IndexedInline[] = [];
  let position = 0;

  for (const inline of inlines) {
    const start = position;
    const end = start + indexedInlineText(inline).length;

    finalized.push({
      ...inline,
      end,
      start,
    });
    position = end;
  }

  return finalized;
}

function compactEditorInlines(inlines: DraftEditorInline[]): DraftEditorInline[] {
  const compacted: DraftEditorInline[] = [];

  for (const inline of inlines) {
    const previous = compacted.at(-1);

    if (previous && canMergeEditorInlines(previous, inline)) {
      compacted[compacted.length - 1] = {
        ...previous,
        node: replaceInlineNodeText(
          previous.node,
          indexedInlineText(previous) + indexedInlineText(inline),
        ),
      };
      continue;
    }

    compacted.push(inline);
  }

  return compacted;
}

// Only text with equal marks, or raw inlines of one original type, merge.
// References and line breaks keep their per-instance identity.
function canMergeEditorInlines(previous: DraftEditorInline, next: DraftEditorInline): boolean {
  const a = previous.node;
  const b = next.node;

  if (!sameLink(previous.link, next.link)) return false;
  if (a.type === "text" && b.type === "text") return a.marks.join(",") === b.marks.join(",");

  return a.type === "raw" && b.type === "raw" && a.originalType === b.originalType;
}

/* Document conversion */

// Indexed and generated nodes are already canonical document nodes, so only
// text that an edit emptied needs dropping.
function editorInlineToDocumentInline({ node }: IndexedInline | DraftEditorInline): Inline | null {
  return node.type === "text" && node.text.length === 0 ? null : node;
}

function replaceInlineNodeText(node: IndexedInline["node"], text: string): IndexedInline["node"] {
  switch (node.type) {
    case "text":
      return createDocumentTextNode(text, node.marks);
    case "raw":
      return createDocumentUnsupportedInlineNode({
        originalType: node.originalType,
        source: text,
      });
    default:
      return node;
  }
}

function sameLink(left: Link | null, right: Link | null): boolean {
  return left?.url === right?.url && left?.title === right?.title;
}
