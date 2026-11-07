// Owns block content insets and wrap width shared by exact measurement,
// virtualization estimates, and measured-height cache keys.

import type { DocumentIndex } from "../../state";
import { CODE_BLOCK_CONTENT_PADDING_X } from "./code-block";
import { resolveListMarkerInset } from "./marker-metrics";
import type { DocumentLayoutOptions } from "./options";

export type LayoutContentMetrics = {
  availableWidth: number;
  codeContentInset: number;
  contentLeft: number;
  listInset: number;
};

export function resolveBlockContentMetrics(
  documentIndex: DocumentIndex,
  indexedBlock: DocumentIndex["blocks"][number],
  options: DocumentLayoutOptions,
): LayoutContentMetrics {
  const left = resolveBlockLeft(options, indexedBlock.depth);
  const listInset = resolveListMarkerInset(documentIndex, indexedBlock.path, options.fontSize);
  const codeContentInset = indexedBlock.block.type === "code" ? CODE_BLOCK_CONTENT_PADDING_X : 0;

  return {
    availableWidth: Math.max(
      40,
      options.width - left - options.paddingX - listInset - codeContentInset * 2,
    ),
    codeContentInset,
    contentLeft: left + codeContentInset,
    listInset,
  };
}

// A list item's marker gutter sits outside every block in the item, so block
// surfaces like table grids, quote bars, and divider rules start where the
// item's text does.
export function resolveBlockSurfaceLeft(
  documentIndex: DocumentIndex,
  block: { depth: number; path: string },
  options: DocumentLayoutOptions,
) {
  return (
    resolveBlockLeft(options, block.depth) +
    resolveListMarkerInset(documentIndex, block.path, options.fontSize)
  );
}

export function resolveBlockLeft(options: DocumentLayoutOptions, depth: number) {
  return options.paddingX + depth * options.indentWidth;
}
