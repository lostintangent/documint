// Owns the cheap per-unit height estimates the planner uses for whole-document
// height. Estimation tolerates text underestimation within overscan but not
// structural overestimation: the exact pass must always be free to extend
// past the planner's predicted bottom.

import type { Block } from "@/document";
import type { DocumentResources } from "@/types";
import type { EditorRegion } from "../../state";
import type { CanvasRenderCache } from "../../canvas/lib/cache";
import type { DocumentLayoutOptions } from "../lib/options";
import { estimateLayout } from "../measure";
import {
  measureTextContainerLines,
  resolveRegionMeasurementCacheIdentity,
  resolveTextBlockFont,
  resolveTextBlockLineHeight,
} from "../measure/text";

export function estimateContainerHeight(
  cache: CanvasRenderCache,
  container: EditorRegion,
  block: Block | null,
  depth: number,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  resources: DocumentResources,
) {
  const cacheKey = createContainerHeightCacheKey(container, options, resources);
  const cached = cache.measuredContainerHeights.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const paddingX = options.paddingX ?? 0;
  const indentWidth = options.indentWidth ?? 24;
  const lineHeight = resolveTextBlockLineHeight(block, options.lineHeight ?? 24);
  const left = paddingX + depth * indentWidth;
  const availableWidth = Math.max(40, options.width - left - paddingX);

  if (container.inlines.some((run) => run.kind === "image")) {
    const font = resolveTextBlockFont(block);
    return measureTextContainerLines(
      cache,
      container,
      font,
      block,
      availableWidth,
      lineHeight,
      resources,
    ).reduce((total, line) => total + line.height, 0);
  }

  const estimate = estimateLayout({
    charWidth: options.charWidth,
    lineHeight,
    text: container.text,
    width: availableWidth,
  });
  const estimatedHeight = Math.max(lineHeight, estimate.lineCount * lineHeight);

  return estimatedHeight;
}

export function estimateTableCellHeight(
  region: EditorRegion,
  width: number,
  lineHeight: number,
  charWidth: number | undefined,
) {
  const estimate = estimateLayout({
    charWidth,
    lineHeight,
    text: region.text,
    width,
  });

  return Math.max(lineHeight, estimate.lineCount * lineHeight);
}

export function createContainerHeightCacheKey(
  container: Pick<EditorRegion, "path" | "inlines" | "text">,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  resources: DocumentResources,
) {
  return `${resolveRegionMeasurementCacheIdentity(container, resources)}:${options.width}:${options.paddingX ?? 0}:${options.indentWidth ?? 24}:${options.lineHeight ?? 24}`;
}
