// Editor-inline manipulation: low-level primitives for slicing, replacing,
// and rebuilding InlineEntry arrays. Used by text replacement and fragment
// extraction to preserve inline semantics while editing region text.
//
// InlineEntry is the runtime projection: each inline references the source
// document Inline node directly (with Link wrappers flattened to an
// orthogonal `link` field), and carries pre-computed char-offset coordinates.
// These primitives operate on InlineEntry arrays and produce either new
// InlineEntry arrays or document-side Inline nodes ready to slot back into
// a Block.

import {
  createCode as createDocumentInlineCodeNode,
  createImage as createDocumentImageNode,
  createLineBreak as createDocumentLineBreakNode,
  createLink as createDocumentLinkNode,
  createMention as createDocumentMentionNode,
  createRaw as createDocumentUnsupportedInlineNode,
  createResource as createDocumentResourceNode,
  createText as createDocumentTextNode,
  defragmentTextInlines,
  isReferenceInlineNode,
  type Inline,
  type Link,
  type Text,
} from "@/document";
import { regionInlines } from "../index/inlines";
import type { InlineEntry, RegionEntry } from "../index/types";

type DraftEditorInline = Omit<InlineEntry, "end" | "start">;

type EditContext = {
  didInsert: boolean;
  generatedInlineCount: number;
  replacementText: string;
};

/* Public entry points */

export function editRegionInlines(
  region: RegionEntry,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): Inline[] {
  return editorInlinesToDocumentInlines(
    replaceEditorInlines(regionInlines(region), startOffset, endOffset, replacementText),
  );
}

export function replaceEditorInlines(
  inlines: readonly InlineEntry[],
  startOffset: number,
  endOffset: number,
  replacementText: string,
) {
  const context: EditContext = {
    didInsert: false,
    generatedInlineCount: 0,
    replacementText,
  };
  const nextInlines = editEditorInlines(inlines, startOffset, endOffset, context);

  return finalizeEditorInlines(compactEditorInlines(nextInlines));
}

export function editorInlinesToDocumentInlines(inlines: readonly InlineEntry[]): Inline[] {
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
  inlines: readonly InlineEntry[],
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
    const localEnd = Math.min(inline.text.length, endOffset - inline.start);
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
  inline: InlineEntry,
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
    case "code":
    case "raw":
      return replaceTextLikeEditorInline(inline, startOffset, endOffset, replacementText);
    case "lineBreak":
      return replaceBreakEditorInline(inline, startOffset, endOffset, replacementText, context);
  }
}

function replaceTextLikeEditorInline(
  inline: InlineEntry,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): DraftEditorInline[] {
  const nextText =
    inline.text.slice(0, startOffset) + replacementText + inline.text.slice(endOffset);

  return nextText.length > 0
    ? [
        {
          ...createDraftEditorInline(inline),
          text: nextText,
        },
      ]
    : [];
}

function replaceBreakEditorInline(
  inline: InlineEntry,
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
  inline: InlineEntry,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): DraftEditorInline[] {
  if (startOffset === 0 && endOffset === inline.text.length) {
    return replacementText.length > 0
      ? [createGeneratedTextInline(replacementText, inline.link, 0)]
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

  inlines.push(
    createGeneratedTextInline(context.replacementText, link, context.generatedInlineCount),
  );
  context.generatedInlineCount += 1;
  context.didInsert = true;
}

function createGeneratedTextInline(
  text: string,
  link: Link | null,
  index: number,
): DraftEditorInline {
  const node: Text = {
    id: `generated:${index}`,
    marks: [],
    text,
    type: "text",
  };
  return {
    link,
    node,
    text,
  };
}

function resolveBoundaryLinkForInsertion(
  previousInline: InlineEntry | null,
  nextInline: InlineEntry | null,
) {
  return previousInline?.link && nextInline?.link && sameLink(previousInline.link, nextInline.link)
    ? previousInline.link
    : null;
}

/* Draft compaction and finalization */

function createDraftEditorInline(inline: InlineEntry): DraftEditorInline {
  return {
    link: inline.link,
    node: inline.node,
    text: inline.text,
  };
}

function finalizeEditorInlines(inlines: DraftEditorInline[]): InlineEntry[] {
  const finalized: InlineEntry[] = [];
  let position = 0;

  for (const inline of inlines) {
    const start = position;
    const end = start + inline.text.length;

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
        text: previous.text + inline.text,
      };
      continue;
    }

    compacted.push(inline);
  }

  return compacted;
}

function canMergeEditorInlines(previous: DraftEditorInline, next: DraftEditorInline): boolean {
  const a = previous.node;
  const b = next.node;

  if (a.type !== b.type) return false;
  if (!sameLink(previous.link, next.link)) return false;
  if (isReferenceInlineNode(a)) {
    // References never merge — combining them into a single span would lose
    // the per-instance external identity (url/userId/...).
    return false;
  }

  switch (a.type) {
    case "text":
      // Both are Text nodes (a.type === b.type === "text").
      return a.marks.join(",") === (b as Text).marks.join(",");
    case "raw":
      return a.originalType === (b as typeof a).originalType;
    case "code":
    case "lineBreak":
      return true;
  }
}

/* Document conversion */

function editorInlineToDocumentInline(inline: InlineEntry | DraftEditorInline): Inline | null {
  const node = inline.node;
  switch (node.type) {
    case "lineBreak":
      return createDocumentLineBreakNode();
    case "image":
      return createDocumentImageNode({
        alt: node.alt,
        title: node.title,
        url: node.url,
        width: node.width,
      });
    case "mention":
      return createDocumentMentionNode({
        name: node.name,
        userId: node.userId,
      });
    case "resource":
      return createDocumentResourceNode({
        label: node.label,
        protocol: node.protocol,
        url: node.url,
      });
    case "code":
      return createDocumentInlineCodeNode(inline.text);
    case "text":
      return inline.text.length > 0 ? createDocumentTextNode(inline.text, node.marks) : null;
    case "raw":
      return createDocumentUnsupportedInlineNode({
        originalType: node.originalType,
        source: inline.text,
      });
  }
}

function sameLink(left: Link | null, right: Link | null): boolean {
  return left?.url === right?.url && left?.title === right?.title;
}
