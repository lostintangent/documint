// Owns per-container height estimates for large-document virtualization and
// the measured heights that replace them. Estimation tolerates text
// underestimation within overscan but not structural overestimation: the exact
// pass must always be free to extend past the estimated bottom.
//
// Measured heights are keyed by content, available width, and typography, never
// by path, so they survive edits that shift paths and rebuild the virtual
// layout. A hash collision can only skew an off-screen estimate, which the next
// measurement corrects.

import { isReferenceInlineNode } from "@/document";
import type { DocumentResources } from "@/editor/resources";
import {
  cacheMeasuredContainerHeight,
  getMeasuredContainerHeight,
  type LayoutCache,
} from "../state/cache";
import { estimateTextHeight } from "./text-estimate";
import {
  measureTextContainerLines,
  resolveTextMeasurementKey,
  sumLineHeights,
  type BlockTypography,
  type LayoutTextInput,
} from "../measure/text";

export function estimateContainerHeight(
  cache: LayoutCache,
  container: LayoutTextInput,
  availableWidth: number,
  typography: BlockTypography,
  charWidth: number,
  resources: DocumentResources,
) {
  const cached = getMeasuredContainerHeight(
    cache,
    resolveTextMeasurementKey(container, availableWidth, typography, resources),
  );

  if (cached !== undefined) {
    return cached;
  }

  // Images and resource chips are sized by their resources, not their text,
  // so they're measured exactly rather than estimated.
  if (
    container.kind === "inlines" &&
    container.inlines.some((inline) => isReferenceInlineNode(inline.node))
  ) {
    return sumLineHeights(
      measureTextContainerLines(cache, container, availableWidth, typography, resources),
    );
  }

  return estimateTextHeight(container.text, availableWidth, charWidth, typography.lineHeight);
}

export function cacheMeasuredHeight(
  cache: LayoutCache,
  container: LayoutTextInput,
  availableWidth: number,
  typography: BlockTypography,
  resources: DocumentResources,
  height: number,
) {
  cacheMeasuredContainerHeight(
    cache,
    resolveTextMeasurementKey(container, availableWidth, typography, resources),
    height,
  );
}
