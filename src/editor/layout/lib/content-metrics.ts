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
  left: number;
  listInset: number;
};

export function resolveBlockContentMetrics(
  documentIndex: DocumentIndex,
  indexedBlock: DocumentIndex["blocks"][number],
  options: DocumentLayoutOptions,
): LayoutContentMetrics {
  const left = options.paddingX + indexedBlock.depth * options.indentWidth;
  const listInset = resolveListMarkerInset(documentIndex, indexedBlock.path, options.fontSize);
  const codeContentInset = indexedBlock.block.type === "code" ? CODE_BLOCK_CONTENT_PADDING_X : 0;

  return {
    availableWidth: Math.max(
      40,
      options.width - left - options.paddingX - listInset - codeContentInset * 2,
    ),
    codeContentInset,
    contentLeft: left + codeContentInset,
    left,
    listInset,
  };
}
