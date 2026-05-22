// Owns inline image sizing policy for document layout. Text measurement asks
// this module for image dimensions instead of embedding resource rules inline.
import type { DocumentResources } from "@/types";
import type { InlineEntry } from "../../state";

const IMAGE_FALLBACK_WIDTH = 240;
const IMAGE_FALLBACK_ASPECT_RATIO = 9 / 16;
const IMAGE_FALLBACK_MIN_HEIGHT = 120;
const IMAGE_MIN_DIMENSION = 48;

export type InlineImageDimensions = {
  height: number;
  width: number;
};

export function resolveInlineImageDimensions(
  inline: InlineEntry,
  resources: DocumentResources,
  availableWidth: number,
): InlineImageDimensions {
  const image = inline.node.type === "image" ? inline.node : null;
  const resource = image ? (resources.images.get(image.url) ?? null) : null;
  const authoredWidth = image?.width ?? null;
  const fallbackWidth = Math.min(availableWidth, authoredWidth ?? IMAGE_FALLBACK_WIDTH);
  const fallbackHeight = Math.max(
    IMAGE_FALLBACK_MIN_HEIGHT,
    Math.round(fallbackWidth * IMAGE_FALLBACK_ASPECT_RATIO),
  );

  if (!resource || resource.intrinsicWidth <= 0 || resource.intrinsicHeight <= 0) {
    return {
      height: fallbackHeight,
      width: fallbackWidth,
    };
  }

  const targetWidth = Math.min(availableWidth, authoredWidth ?? resource.intrinsicWidth);
  const scale = Math.min(1, targetWidth / resource.intrinsicWidth);

  return {
    height: Math.max(IMAGE_MIN_DIMENSION, Math.round(resource.intrinsicHeight * scale)),
    width: Math.max(IMAGE_MIN_DIMENSION, Math.round(resource.intrinsicWidth * scale)),
  };
}

export function resolveInlineImageSignature(inline: InlineEntry, resources: DocumentResources) {
  if (inline.node.type !== "image") {
    return `${inline.node.type}:missing-image`;
  }

  const image = inline.node;
  const resource = resources.images.get(image.url);

  return `image:${image.url}:${image.width ?? 0}:${resource?.status ?? "loading"}:${resource?.intrinsicWidth ?? 0}:${resource?.intrinsicHeight ?? 0}`;
}
