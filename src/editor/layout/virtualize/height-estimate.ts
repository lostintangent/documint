// Owns cheap per-path height estimates for large-document virtualization.
// Estimation tolerates text underestimation within overscan but not structural
// overestimation: the exact pass must always be free to extend past the
// estimated bottom.

import { isReferenceInlineNode, type Block } from "@/document";
import type { DocumentResources } from "@/editor/resources";
import type { LayoutCache } from "../state/cache";
import type { LayoutContentMetrics } from "../lib/content-metrics";
import type { DocumentLayoutOptions } from "../lib/options";
import { CODE_BLOCK_BACKGROUND_PADDING_Y } from "../lib/code-block";
import { estimateTextHeight } from "./text-estimate";
import {
  measureTextContainerLines,
  resolveBlockTypography,
  resolveTextMeasurementCacheIdentity,
  sumLineHeights,
  type LayoutTextInput,
} from "../measure/text";

export function estimateContainerHeight(
  cache: LayoutCache,
  container: LayoutTextInput,
  block: Block | null,
  contentMetrics: LayoutContentMetrics,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  const cacheKey = createContainerHeightCacheKey(container, contentMetrics, options, resources);
  const cached = cache.measuredContainerHeights.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const typography = resolveBlockTypography(block, options.fontSize, options.lineHeight);

  if (
    container.kind === "inlines" &&
    container.inlines.some((inline) => isReferenceInlineNode(inline.node))
  ) {
    return sumLineHeights(
      measureTextContainerLines(
        cache,
        container,
        contentMetrics.availableWidth,
        typography,
        resources,
      ),
    );
  }

  const estimatedHeight = estimateTextHeight(
    container.text,
    contentMetrics.availableWidth,
    options.charWidth,
    typography.lineHeight,
  );

  return block?.type === "code"
    ? estimatedHeight + CODE_BLOCK_BACKGROUND_PADDING_Y * 2
    : estimatedHeight;
}

export function createContainerHeightCacheKey(
  container: LayoutTextInput,
  contentMetrics: Pick<LayoutContentMetrics, "codeContentInset" | "listInset">,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  // fontSize joins lineHeight in the key: if an embedder pins lineHeight
  // explicitly while fontSize varies, heading/code-derived heights would
  // otherwise be served stale from this cache.
  return `${resolveTextMeasurementCacheIdentity(container, resources)}:${options.width}:${options.paddingX}:${options.indentWidth}:${options.fontSize}:${options.lineHeight}:${contentMetrics.listInset}:${contentMetrics.codeContentInset}`;
}
