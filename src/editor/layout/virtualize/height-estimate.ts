// Owns cheap per-region height estimates for large-document virtualization.
// Estimation tolerates text underestimation within overscan but not structural
// overestimation: the exact pass must always be free to extend past the
// estimated bottom.

import { isReferenceInlineNode, type Block } from "@/document";
import type { DocumentResources } from "@/types";
import { regionInlines, type EditableRegion } from "../../state";
import type { LayoutCache } from "../state/cache";
import type { DocumentLayoutOptions } from "../lib/options";
import { CODE_BLOCK_BACKGROUND_PADDING_Y, CODE_BLOCK_CONTENT_PADDING_X } from "../lib/code-block";
import { estimateTextLayout } from "./text-estimate";
import {
  measureTextContainerLines,
  resolveBlockTypography,
  resolveRegionMeasurementCacheIdentity,
} from "../measure/text";

export function estimateContainerHeight(
  cache: LayoutCache,
  container: EditableRegion,
  block: Block | null,
  depth: number,
  // List item content is shifted right by this inset (bullet or task
  // checkbox); subtracting it here keeps the estimator's wrap math in
  // step with measure's exact wrap. Non-list regions pass 0.
  listInset: number,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  const codeContentInset = block?.type === "code" ? CODE_BLOCK_CONTENT_PADDING_X : 0;
  const cacheKey = createContainerHeightCacheKey(
    container,
    listInset,
    codeContentInset,
    options,
    resources,
  );
  const cached = cache.measuredContainerHeights.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const typography = resolveBlockTypography(block, options.fontSize, options.lineHeight);
  const left = options.paddingX + depth * options.indentWidth;
  const availableWidth = Math.max(
    40,
    options.width - left - options.paddingX - listInset - codeContentInset * 2,
  );

  if (regionInlines(container).some((inline) => isReferenceInlineNode(inline.node))) {
    return measureTextContainerLines(
      cache,
      container,
      block,
      availableWidth,
      typography,
      resources,
    ).reduce((total, line) => total + line.height, 0);
  }

  const estimate = estimateTextLayout({
    charWidth: options.charWidth,
    lineHeight: typography.lineHeight,
    text: container.text,
    width: availableWidth,
  });
  const estimatedHeight = Math.max(typography.lineHeight, estimate.lineCount * typography.lineHeight);

  return block?.type === "code"
    ? estimatedHeight + CODE_BLOCK_BACKGROUND_PADDING_Y * 2
    : estimatedHeight;
}

export function estimateTableCellHeight(
  region: EditableRegion,
  width: number,
  lineHeight: number,
  charWidth: number | undefined,
) {
  const estimate = estimateTextLayout({
    charWidth,
    lineHeight,
    text: region.text,
    width,
  });

  return Math.max(lineHeight, estimate.lineCount * lineHeight);
}

export function createContainerHeightCacheKey(
  container: EditableRegion,
  listInset: number,
  codeContentInset: number,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  // fontSize joins lineHeight in the key: if an embedder pins lineHeight
  // explicitly while fontSize varies, heading/code-derived heights would
  // otherwise be served stale from this cache.
  return `${resolveRegionMeasurementCacheIdentity(container, resources)}:${options.width}:${options.paddingX}:${options.indentWidth}:${options.fontSize}:${options.lineHeight}:${listInset}:${codeContentInset}`;
}
