// Editor-inline manipulation: low-level primitives for slicing, replacing,
// and rebuilding EditorInline arrays. Used by the text reducer to apply
// edits to a region's children, and exposed to tests for direct coverage.
//
// EditorInline is the runtime projection: each "run" carries link/image/
// marks/code state plus precomputed offsets. These primitives operate on
// EditorInline arrays and produce either new EditorInline arrays or
// document-side Inline nodes ready to slot back into a Block.

import {
  createCode as createDocumentInlineCodeNode,
  createImage as createDocumentImageNode,
  createLineBreak as createDocumentLineBreakNode,
  createLink as createDocumentLinkNode,
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
} from "../index/types";

type DraftEditorInline = Omit<EditorInline, "end" | "start">;

type EditContext = {
  didInsert: boolean;
  generatedRunCount: number;
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
    generatedRunCount: 0,
    replacementText,
  };
  const nextInlines = editEditorInlines(inlines, startOffset, endOffset, context);

  return finalizeEditorInlines(compactEditorInlines(nextInlines));
}

export function editorInlinesToDocumentInlines(inlines: EditorInline[]): Inline[] {
  const nodes: Inline[] = [];

  for (let index = 0; index < inlines.length; index += 1) {
    const run = inlines[index]!;

    if (run.link) {
      const children: Inline[] = [];
      const link = run.link;

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

    const node = editorInlineToDocumentInline(run);

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

  for (const [index, run] of inlines.entries()) {
    if (!context.didInsert && startOffset === endOffset && startOffset === run.start) {
      pushGeneratedTextRun(
        nextInlines,
        context,
        resolveBoundaryLinkForInsertion(inlines[index - 1] ?? null, run),
      );
    }

    if (endOffset <= run.start || startOffset >= run.end) {
      nextInlines.push(createDraftEditorInline(run));
      continue;
    }

    const localStart = Math.max(0, startOffset - run.start);
    const localEnd = Math.min(run.text.length, endOffset - run.start);
    const replacement =
      !context.didInsert && context.replacementText.length > 0 ? context.replacementText : "";
    const nextForRun = replaceEditorInline(run, localStart, localEnd, replacement, context);

    if (localStart !== localEnd || replacement.length > 0) {
      context.didInsert = true;
    }

    nextInlines.push(...nextForRun);
  }

  if (!context.didInsert) {
    pushGeneratedTextRun(
      nextInlines,
      context,
      resolveBoundaryLinkForInsertion(inlines.at(-1) ?? null, null),
    );
  }

  return nextInlines;
}

function replaceEditorInline(
  run: EditorInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  context: EditContext,
) {
  switch (run.kind) {
    case "text":
    case "code":
    case "raw":
      return replaceTextLikeEditorInline(run, startOffset, endOffset, replacementText);
    case "lineBreak":
      return replaceBreakEditorInline(run, startOffset, endOffset, replacementText, context);
    case "image":
      return replaceImageEditorInline(run, startOffset, endOffset, replacementText);
  }
}

function replaceTextLikeEditorInline(
  run: EditorInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
) {
  const nextText = run.text.slice(0, startOffset) + replacementText + run.text.slice(endOffset);

  return nextText.length > 0
    ? [
        {
          ...createDraftEditorInline(run),
          text: nextText,
        },
      ]
    : [];
}

function replaceBreakEditorInline(
  run: EditorInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  context: EditContext,
) {
  if (startOffset === endOffset) {
    return [createDraftEditorInline(run)];
  }

  const nextInlines: DraftEditorInline[] = [];

  if (replacementText.length > 0) {
    pushGeneratedTextRun(nextInlines, context, run.link);
  }

  return nextInlines;
}

function replaceImageEditorInline(
  run: EditorInline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
) {
  if (startOffset === 0 && endOffset === run.text.length) {
    return replacementText.length > 0 ? [createGeneratedTextRun(replacementText, run.link, 0)] : [];
  }

  return [createDraftEditorInline(run)];
}

/* Generated runs and boundary resolution */

function pushGeneratedTextRun(
  inlines: DraftEditorInline[],
  context: EditContext,
  link: RuntimeLinkAttributes | null,
) {
  if (context.replacementText.length === 0) {
    context.didInsert = true;
    return;
  }

  inlines.push(createGeneratedTextRun(context.replacementText, link, context.generatedRunCount));
  context.generatedRunCount += 1;
  context.didInsert = true;
}

function createGeneratedTextRun(
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
    originalType: null,
    text,
  };
}

function resolveBoundaryLinkForInsertion(
  previousRun: EditorInline | null,
  nextRun: EditorInline | null,
) {
  return previousRun?.link && nextRun?.link && sameRuntimeLink(previousRun.link, nextRun.link)
    ? previousRun.link
    : null;
}

/* Draft compaction and finalization */

function createDraftEditorInline(run: EditorInline): DraftEditorInline {
  return {
    id: run.id,
    image: run.image,
    inlineCode: run.inlineCode,
    kind: run.kind,
    link: run.link,
    marks: run.marks,
    originalType: run.originalType,
    text: run.text,
  };
}

function finalizeEditorInlines(inlines: DraftEditorInline[]) {
  const finalized: EditorInline[] = [];
  let position = 0;

  for (const run of inlines) {
    const start = position;
    const end = start + run.text.length;

    finalized.push({
      ...run,
      end,
      start,
    });
    position = end;
  }

  return finalized;
}

function compactEditorInlines(inlines: DraftEditorInline[]) {
  const compacted: DraftEditorInline[] = [];

  for (const run of inlines) {
    const previous = compacted.at(-1);

    if (previous && canMergeEditorInlines(previous, run)) {
      compacted[compacted.length - 1] = {
        ...previous,
        text: previous.text + run.text,
      };
      continue;
    }

    compacted.push(run);
  }

  return compacted;
}

function canMergeEditorInlines(previous: DraftEditorInline, next: DraftEditorInline) {
  return (
    previous.kind === next.kind &&
    previous.inlineCode === next.inlineCode &&
    sameRuntimeLink(previous.link, next.link) &&
    sameRuntimeImage(previous.image, next.image) &&
    previous.originalType === next.originalType &&
    previous.marks.join(",") === next.marks.join(",")
  );
}

/* Document conversion */

function editorInlineToDocumentInline(run: EditorInline): Inline | null {
  switch (run.kind) {
    case "lineBreak":
      return createDocumentLineBreakNode();
    case "image":
      return run.image ? createImageNodeFromRuntimeAttributes(run.image) : null;
    case "code":
      return createDocumentInlineCodeNode({
        code: run.text,
      });
    case "text":
      return run.text.length > 0
        ? createDocumentTextNode({
            marks: run.marks,
            text: run.text,
          })
        : null;
    case "raw":
      return createDocumentUnsupportedInlineNode({
        originalType: run.originalType ?? "raw",
        source: run.text,
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
