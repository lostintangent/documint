// Editor-inline manipulation: low-level primitives for slicing, replacing,
// and rebuilding EditorInline arrays. Used by text replacement and fragment
// extraction to preserve inline semantics while editing region text.
//
// EditorInline is the runtime projection: each inline carries link/image/
// marks/code state plus precomputed offsets. These primitives operate on
// EditorInline arrays and produce either new EditorInline arrays or
// document-side Inline nodes ready to slot back into a Block.

import {
  createCode as createDocumentInlineCodeNode,
  createImage as createDocumentImageNode,
  createLineBreak as createDocumentLineBreakNode,
  createLink as createDocumentLinkNode,
  createMention as createDocumentMentionNode,
  createRaw as createDocumentUnsupportedInlineNode,
  createText as createDocumentTextNode,
  defragmentTextInlines,
  type Inline,
} from "@/document";
import type {
  EditorInline,
  EditorRegion,
  RuntimeImageAttributes,
  RuntimeLinkAttributes,
  RuntimeMentionAttributes,
} from "../index/types";

type DraftEditorInline = Omit<EditorInline, "end" | "start">;

type EditContext = {
  didInsert: boolean;
  generatedInlineCount: number;
  replacementText: string;
};

/* Public entry points */

export function editRegionInlines(
  region: EditorRegion,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): Inline[] {
  return editorInlinesToDocumentInlines(
    replaceEditorInlines(region.inlines, startOffset, endOffset, replacementText),
  );
}

export function replaceEditorInlines(
  inlines: EditorInline[],
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

export function editorInlinesToDocumentInlines(inlines: EditorInline[]): Inline[] {
  const nodes: Inline[] = [];

  for (let index = 0; index < inlines.length; index += 1) {
    const inline = inlines[index]!;

    if (inline.link) {
      const children: Inline[] = [];
      const link = inline.link;

      while (index < inlines.length && sameRuntimeLink(inlines[index]!.link, link)) {
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
  inlines: EditorInline[],
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
  inline: EditorInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  context: EditContext,
) {
  switch (inline.kind) {
    case "text":
    case "code":
    case "raw":
      return replaceTextLikeEditorInline(inline, startOffset, endOffset, replacementText);
    case "lineBreak":
      return replaceBreakEditorInline(inline, startOffset, endOffset, replacementText, context);
    case "image":
    case "mention":
      return replaceAtomicEditorInline(inline, startOffset, endOffset, replacementText);
  }
}

function replaceTextLikeEditorInline(
  inline: EditorInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
) {
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
  inline: EditorInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  context: EditContext,
) {
  if (startOffset === endOffset) {
    return [createDraftEditorInline(inline)];
  }

  const nextInlines: DraftEditorInline[] = [];

  if (replacementText.length > 0) {
    pushGeneratedTextInline(nextInlines, context, inline.link);
  }

  return nextInlines;
}

function replaceAtomicEditorInline(
  inline: EditorInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
) {
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
  link: RuntimeLinkAttributes | null,
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
  link: RuntimeLinkAttributes | null,
  index: number,
): DraftEditorInline {
  return {
    id: `generated:${index}`,
    image: null,
    inlineCode: false,
    kind: "text",
    link,
    marks: [],
    mention: null,
    originalType: null,
    text,
  };
}

function resolveBoundaryLinkForInsertion(
  previousInline: EditorInline | null,
  nextInline: EditorInline | null,
) {
  return previousInline?.link &&
    nextInline?.link &&
    sameRuntimeLink(previousInline.link, nextInline.link)
    ? previousInline.link
    : null;
}

/* Draft compaction and finalization */

function createDraftEditorInline(inline: EditorInline): DraftEditorInline {
  return {
    id: inline.id,
    image: inline.image,
    inlineCode: inline.inlineCode,
    kind: inline.kind,
    link: inline.link,
    marks: inline.marks,
    mention: inline.mention,
    originalType: inline.originalType,
    text: inline.text,
  };
}

function finalizeEditorInlines(inlines: DraftEditorInline[]) {
  const finalized: EditorInline[] = [];
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

function compactEditorInlines(inlines: DraftEditorInline[]) {
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

function canMergeEditorInlines(previous: DraftEditorInline, next: DraftEditorInline) {
  return (
    previous.kind === next.kind &&
    previous.inlineCode === next.inlineCode &&
    sameRuntimeLink(previous.link, next.link) &&
    sameRuntimeImage(previous.image, next.image) &&
    sameRuntimeMention(previous.mention, next.mention) &&
    previous.originalType === next.originalType &&
    previous.marks.join(",") === next.marks.join(",")
  );
}

/* Document conversion */

function editorInlineToDocumentInline(inline: EditorInline): Inline | null {
  switch (inline.kind) {
    case "lineBreak":
      return createDocumentLineBreakNode();
    case "image":
      return inline.image ? createImageNodeFromRuntimeAttributes(inline.image) : null;
    case "mention":
      return inline.mention ? createMentionNodeFromRuntimeAttributes(inline.mention) : null;
    case "code":
      return createDocumentInlineCodeNode(inline.text);
    case "text":
      return inline.text.length > 0 ? createDocumentTextNode(inline.text, inline.marks) : null;
    case "raw":
      return createDocumentUnsupportedInlineNode({
        originalType: inline.originalType ?? "raw",
        source: inline.text,
      });
  }
}

function createImageNodeFromRuntimeAttributes(image: RuntimeImageAttributes) {
  return createDocumentImageNode({
    alt: image.alt,
    title: image.title,
    url: image.url,
    width: image.width,
  });
}

function createMentionNodeFromRuntimeAttributes(mention: RuntimeMentionAttributes) {
  return createDocumentMentionNode({
    name: mention.name,
    userId: mention.userId,
  });
}

function sameRuntimeLink(left: RuntimeLinkAttributes | null, right: RuntimeLinkAttributes | null) {
  return left?.url === right?.url && left?.title === right?.title;
}

function sameRuntimeImage(
  left: RuntimeImageAttributes | null,
  right: RuntimeImageAttributes | null,
) {
  return (
    left?.url === right?.url &&
    left?.title === right?.title &&
    left?.alt === right?.alt &&
    left?.width === right?.width
  );
}

function sameRuntimeMention(
  left: RuntimeMentionAttributes | null,
  right: RuntimeMentionAttributes | null,
) {
  return left?.userId === right?.userId && left?.name === right?.name;
}
