// Owns paint policy for document image segments. The main paint module
// delegates image-specific draw behavior here so text and image rendering stay
// separate.
import type { DocumentLayout, LayoutRect } from "@/editor/layout";
import type { DocumentResources, ResolvedEditorTheme } from "@/types";
import type { DocumentFrameLine } from "../frame";
import type { ImageSegment } from "../frame/line/text-segments";

const imageFallbackAspectRatio = 9 / 16;
const imageMinimumHeight = 48;
const imagePlaceholderLabelFont =
  '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const imagePlaceholderIconInset = 12;
const imagePlaceholderIconMaximumSize = 34;
const imagePlaceholderIconMinimumSize = 18;
const imagePlaceholderIconScale = 0.18;
const imagePlaceholderStrokeWidth = 1.5;
const imagePlaceholderLabelOffset = 0.9;
const imagePlaceholderTopBias = 0.95;
const imageLoadingCycleMs = 1800;
const imageLoadingShimmerMinimumWidth = 48;
const imageLoadingShimmerWidthScale = 0.22;

type ImagePlaceholderBox = LayoutRect & {
  ambientAnimationTime: number;
  status: "error" | "loading";
};

export function paintImageSegment(
  context: CanvasRenderingContext2D,
  lineFrame: DocumentFrameLine,
  segment: ImageSegment,
  frameContext: {
    clocks: { ambientAnimation: number };
    resources: DocumentResources;
    theme: ResolvedEditorTheme;
  },
) {
  const { clocks, resources, theme } = frameContext;
  const width = Math.max(24, segment.right - segment.left);
  const resource = resources.images.get(segment.image.url) ?? null;
  const imageHeight = resolvePaintedImageHeight(segment, resources, width);
  const box = resolveImageSegmentPaintBox(lineFrame.layoutLine, segment.left, width, imageHeight);

  context.fillStyle = theme.imageSurfaceBackground;
  context.fillRect(box.left, box.top, box.width, box.height);

  if (resource?.status === "loaded" && resource.source) {
    context.drawImage(resource.source, box.left, box.top, box.width, box.height);
  } else {
    paintImagePlaceholder(context, theme, {
      ...box,
      ambientAnimationTime: clocks.ambientAnimation,
      status: resource?.status === "error" ? "error" : "loading",
    });
  }

  context.strokeStyle = theme.imageSurfaceBorder;
  context.strokeRect(box.left, box.top, box.width, box.height);
}

function paintImagePlaceholder(
  context: CanvasRenderingContext2D,
  theme: ResolvedEditorTheme,
  box: ImagePlaceholderBox,
) {
  const label = box.status === "loading" ? "Loading image" : "Image unavailable";
  const icon = resolveImagePlaceholderIconBox(box);
  const labelTop = box.top + box.height / 2 + icon.size * imagePlaceholderLabelOffset;

  context.save();
  context.beginPath();
  context.rect(box.left, box.top, box.width, box.height);
  context.clip();

  if (box.status === "loading") {
    paintImageLoadingShimmer(context, theme, box, box.ambientAnimationTime);
  }

  context.strokeStyle = theme.imagePlaceholderIcon;
  context.lineWidth = imagePlaceholderStrokeWidth;
  context.strokeRect(icon.left, icon.top, icon.size, icon.size);

  // Image placeholder icon: sun circle + mountain ridge, drawn in proportional
  // coordinates within the icon bounding box.
  context.beginPath();
  context.arc(
    icon.left + icon.size * 0.28,
    icon.top + icon.size * 0.3,
    icon.size * 0.1,
    0,
    Math.PI * 2,
  );
  context.moveTo(icon.left + icon.size * 0.12, icon.top + icon.size * 0.82);
  context.lineTo(icon.left + icon.size * 0.42, icon.top + icon.size * 0.5);
  context.lineTo(icon.left + icon.size * 0.58, icon.top + icon.size * 0.66);
  context.lineTo(icon.left + icon.size * 0.78, icon.top + icon.size * 0.38);
  context.lineTo(icon.left + icon.size * 0.88, icon.top + icon.size * 0.82);
  context.stroke();

  context.font = imagePlaceholderLabelFont;
  context.fillStyle = theme.imagePlaceholderText;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, box.left + box.width / 2, labelTop);
  context.restore();
}

function paintImageLoadingShimmer(
  context: CanvasRenderingContext2D,
  theme: ResolvedEditorTheme,
  box: LayoutRect,
  ambientAnimationTime: number,
) {
  const shimmerWidth = Math.max(
    imageLoadingShimmerMinimumWidth,
    Math.round(box.width * imageLoadingShimmerWidthScale),
  );
  const travelWidth = box.width + shimmerWidth * 2;
  const progress = (ambientAnimationTime % imageLoadingCycleMs) / imageLoadingCycleMs;
  const shimmerLeft = box.left - shimmerWidth + travelWidth * progress;
  const gradient = context.createLinearGradient(
    shimmerLeft,
    box.top,
    shimmerLeft + shimmerWidth,
    box.top,
  );

  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.5, theme.imageLoadingOverlay);
  gradient.addColorStop(1, "rgba(255,255,255,0)");

  context.fillStyle = gradient;
  context.fillRect(box.left, box.top, box.width, box.height);
}

function resolvePaintedImageHeight(
  segment: ImageSegment,
  resources: DocumentResources,
  width: number,
) {
  const resource = resources.images.get(segment.image.url);

  if (!resource || resource.intrinsicWidth <= 0 || resource.intrinsicHeight <= 0) {
    return resolveFallbackImageHeight(width);
  }

  return Math.max(
    imageMinimumHeight,
    Math.round(width * (resource.intrinsicHeight / resource.intrinsicWidth)),
  );
}

function resolveImageSegmentPaintBox(
  line: DocumentLayout["lines"][number],
  left: number,
  width: number,
  height: number,
): LayoutRect {
  return {
    height,
    left,
    top: line.top + Math.max(0, Math.floor((line.height - height) / 2)),
    width,
  };
}

function resolveImagePlaceholderIconBox(box: LayoutRect) {
  const size = Math.max(
    imagePlaceholderIconMinimumSize,
    Math.min(
      imagePlaceholderIconMaximumSize,
      Math.round(Math.min(box.width, box.height) * imagePlaceholderIconScale),
    ),
  );

  return {
    left: box.left + Math.max(imagePlaceholderIconInset, Math.round((box.width - size) / 2)),
    size,
    top:
      box.top +
      Math.max(
        imagePlaceholderIconInset,
        Math.round(box.height / 2 - size * imagePlaceholderTopBias),
      ),
  };
}

function resolveFallbackImageHeight(width: number) {
  return Math.max(imageMinimumHeight, Math.round(width * imageFallbackAspectRatio));
}
