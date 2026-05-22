// Inline construction and inline-query helpers. The construction primitive
// (`flattenInlineNodes`) walks a document `Inline` tree into the editor's
// flat `InlineEntry[]` projection; Link wrappers are unwrapped and propagated
// to children via the orthogonal `link` field; atomic kinds (image, mention)
// project to the object-replacement character so selection arithmetic stays
// uniform across the flat character stream.
//
// `regionInlines` / `findInlinesInSpan` are the canonical accessors over
// the resulting `InlineEntry[]`. They live alongside the construction
// primitive so a contributor reading "where do region inlines come from?"
// finds both projection and consumption in one place.

import type { Inline, Link } from "@/document";
import type { InlineEntry, RegionEntry } from "./types";

// Contract: `INLINE_OBJECT_REPLACEMENT_TEXT.length === 1`. The document's
// `measureInlineNodeText` (the single length oracle, exported from
// `@/document`) returns `1` for atomic kinds (`image` / `mention`) on the
// assumption that the editor projects them to a one-character placeholder.
// Widening the placeholder requires updating that oracle in lockstep.

// Placeholder character (U+FFFC OBJECT REPLACEMENT CHARACTER) used for atomic
// inline objects (image, mention) in the region text-space, so selection
// arithmetic and hit testing can treat the flat character stream uniformly.
export const INLINE_OBJECT_REPLACEMENT_TEXT = "￼";

export function flattenInlineNodes(
  nodes: readonly Inline[],
  link: Link | null = null,
): InlineEntry[] {
  const inlines: InlineEntry[] = [];
  let position = 0;

  for (const node of nodes) {
    if (node.type === "link") {
      for (const childInline of flattenInlineNodes(node.children, node)) {
        const start = position;
        const end = start + childInline.text.length;
        inlines.push({ ...childInline, end, start });
        position = end;
      }
      continue;
    }

    const text = projectInlineText(node);
    const start = position;
    const end = start + text.length;
    inlines.push({ end, link, node, start, text });
    position = end;
  }

  return inlines;
}

// Maps a non-link Inline node to its projected character span in editor
// selection-offset space. Atomic kinds (image, mention) project to a single
// placeholder; line breaks project to `\n`; text/code/raw use their own
// content. This is the only place the projection table lives. The *length*
// of the result must equal `measureInlineNodeText(node)` from `@/document` —
// that helper is the canonical length oracle for this same coordinate space.
function projectInlineText(node: Exclude<Inline, Link>): string {
  switch (node.type) {
    case "text":
      return node.text;
    case "code":
      return node.code;
    case "image":
    case "mention":
      return INLINE_OBJECT_REPLACEMENT_TEXT;
    case "lineBreak":
      return "\n";
    case "raw":
      return node.source;
  }
}

// Returns the inlines for an inline-bearing region, or an empty array for
// source regions (code, raw). Renderer/layout consumers can iterate the
// result uniformly; source regions fall through their inlines loop and
// paint `region.text` as a single text run instead.
export function regionInlines(region: RegionEntry): readonly InlineEntry[] {
  return region.content.kind === "inline-text" ? region.content.inlines : EMPTY_INLINES;
}

const EMPTY_INLINES: readonly InlineEntry[] = [];

// Returns the inlines whose extent overlaps the half-open span [start, end).
// Right-exclusive matches the wrapping convention everywhere else: a line
// that ends at offset N does not include the inline starting at N.
export function findInlinesInSpan(
  inlines: readonly InlineEntry[],
  start: number,
  end: number,
): InlineEntry[] {
  return inlines.filter((inline) => inline.end > start && inline.start < end);
}
