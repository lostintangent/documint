// Owns inline image sizing policy for document layout. Text measurement asks
// this module for image dimensions instead of embedding resource rules inline.
import type { DocumentResources } from "@/editor/resources";
import type { IndexedInline } from "../../state";

const IMAGE_FALLBACK_WIDTH = 240;
const IMAGE_FALLBACK_ASPECT_RATIO = 9 / 16;
const IMAGE_FALLBACK_MIN_HEIGHT = 120;

export type InlineImageDimensions = {
  height: number;
  width: number;
};

export function resolveInlineImageDimensions(
  inline: IndexedInline,
  resources: DocumentResources,
  {
    availableWidth,
    emSize,
    standalone,
  }: {
    availableWidth: number;
    emSize: number;
    standalone: boolean;
  },
): InlineImageDimensions {
  const image = inline.node.type === "image" ? inline.node : null;
  const resource = image ? (resources.images.get(image.url) ?? null) : null;
  const authoredWidth = image?.width ?? null;

  // Until its size is known, an image alone in its container reserves a
  // figure frame. One that flows with text or other images, like a row of
  // README badges, reserves an em square so its line keeps its height and
  // wrapping while it loads.
  if (!resource || resource.intrinsicWidth <= 0 || resource.intrinsicHeight <= 0) {
    const width = Math.min(
      availableWidth,
      authoredWidth ?? (standalone ? IMAGE_FALLBACK_WIDTH : emSize),
    );

    return {
      height: standalone
        ? Math.max(IMAGE_FALLBACK_MIN_HEIGHT, Math.round(width * IMAGE_FALLBACK_ASPECT_RATIO))
        : emSize,
      width,
    };
  }

  const targetWidth = Math.min(availableWidth, authoredWidth ?? resource.intrinsicWidth);
  const scale = Math.min(1, targetWidth / resource.intrinsicWidth);

  return {
    height: Math.round(resource.intrinsicHeight * scale),
    width: Math.round(resource.intrinsicWidth * scale),
  };
}

export function resolveInlineImageSignature(inline: IndexedInline, resources: DocumentResources) {
  if (inline.node.type !== "image") {
    return `${inline.node.type}:missing-image`;
  }

  const image = inline.node;
  const resource = resources.images.get(image.url);

  return `image:${image.url}:${image.width ?? 0}:${resource?.status ?? "loading"}:${resource?.intrinsicWidth ?? 0}:${resource?.intrinsicHeight ?? 0}`;
}
