// Inline construction and inline-query helpers. The construction primitive
// (`flattenInlineNodes`) walks a document `Inline` tree into the editor's flat
// `IndexedInline[]` runtime range map. Link wrappers are unwrapped and
// propagated to children via the orthogonal `link` field; reference kinds
// occupy the object-replacement character so selection arithmetic stays
// uniform across the flat character stream.
//
// `regionInlines` / `findInlinesInRange` are the canonical accessors over
// the resulting `IndexedInline[]`. They live alongside the construction
// primitive so a contributor reading "where do region inlines come from?"
// finds both construction and consumption in one place.

import { extractPlainTextFromInlineNodes, type Inline, type Link, type Mark } from "@/document";
import { editorInlineText } from "../../text/inline-offsets";
import type { IndexedInline, EditableRegion } from "./types";

export type InlineOffsetAffinity = "after" | "before";

const EMPTY_INLINES: readonly IndexedInline[] = [];

// Construction --------------------------------------------------------------

export function flattenInlineNodes(
  nodes: readonly Inline[],
  link: Link | null = null,
): IndexedInline[] {
  const inlines: IndexedInline[] = [];
  let position = 0;

  for (const node of nodes) {
    if (node.type === "link") {
      for (const childInline of flattenInlineNodes(node.children, node)) {
        const start = position;
        const end = start + indexedInlineText(childInline).length;
        inlines.push({ ...childInline, end, start });
        position = end;
      }
      continue;
    }

    const text = editorInlineText(node);
    const start = position;
    const end = start + text.length;
    inlines.push({ end, link, node, start });
    position = end;
  }

  return inlines;
}

export function indexedInlineText(inline: Pick<IndexedInline, "node">): string {
  return editorInlineText(inline.node);
}

export function inlineMarks(inline: Pick<IndexedInline, "node">): readonly Mark[] {
  return inline.node.type === "text" ? inline.node.marks : [];
}

// Accessors -----------------------------------------------------------------

// Returns the indexed inlines for an inline-bearing region, or an empty array for
// source regions (code, raw). Renderer/layout consumers can iterate the
// result uniformly; source regions fall through their inline loop and
// paint `region.text` as a single text run instead.
export function regionInlines(region: EditableRegion): readonly IndexedInline[] {
  return region.content.kind === "inlines" ? region.content.inlines : EMPTY_INLINES;
}

// Returns the inlines whose extent overlaps the half-open range [start, end).
// Right-exclusive matches the wrapping convention everywhere else: a line
// that ends at offset N does not include the inline starting at N.
export function findInlinesInRange(
  inlines: readonly IndexedInline[],
  start: number,
  end: number,
): IndexedInline[] {
  return inlines.filter((inline) => inline.end > start && inline.start < end);
}

// Offset conversion ---------------------------------------------------------

export function regionOffsetToPlainTextOffset(region: EditableRegion, offset: number) {
  const normalizedOffset = clamp(offset, 0, region.text.length);

  if (region.content.kind === "source") {
    return normalizedOffset;
  }

  let plainTextOffset = 0;

  for (const inline of region.content.inlines) {
    const plainTextLength = indexedInlinePlainText(inline).length;

    if (normalizedOffset <= inline.start) {
      return plainTextOffset;
    }

    if (normalizedOffset < inline.end) {
      return inline.end - inline.start === plainTextLength
        ? plainTextOffset + normalizedOffset - inline.start
        : plainTextOffset + plainTextLength;
    }

    if (normalizedOffset === inline.end) {
      return plainTextOffset + plainTextLength;
    }

    plainTextOffset += plainTextLength;
  }

  return plainTextOffset;
}

export function plainTextOffsetToRegionOffset(
  region: EditableRegion,
  offset: number,
  affinity: InlineOffsetAffinity,
) {
  if (region.content.kind === "source") {
    return clamp(offset, 0, region.text.length);
  }

  const normalizedOffset = Math.max(0, offset);
  let plainTextOffset = 0;

  for (const inline of region.content.inlines) {
    const inlinePlainTextLength = indexedInlinePlainText(inline).length;
    const inlinePlainTextEnd = plainTextOffset + inlinePlainTextLength;

    if (inlinePlainTextLength === 0 && normalizedOffset === plainTextOffset) {
      return affinity === "after" ? inline.end : inline.start;
    }

    if (normalizedOffset <= plainTextOffset) {
      return inline.start;
    }

    if (normalizedOffset < inlinePlainTextEnd) {
      return inline.end - inline.start === inlinePlainTextLength
        ? inline.start + normalizedOffset - plainTextOffset
        : affinity === "after"
          ? inline.end
          : inline.start;
    }

    if (normalizedOffset === inlinePlainTextEnd) {
      return inline.end;
    }

    plainTextOffset = inlinePlainTextEnd;
  }

  return region.text.length;
}

function indexedInlinePlainText(inline: IndexedInline) {
  return extractPlainTextFromInlineNodes([inline.node]);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}
