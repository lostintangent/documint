// Owns inline image sizing policy for document layout. Text measurement asks
// this module for image dimensions instead of embedding resource rules inline.
import type { DocumentResources } from "../resources";
import type { DocumentEditorTextRun } from "../model/document-editor";

export type InlineImageDimensions = {
  height: number;
  width: number;
};

export function resolveInlineImageDimensions(
  run: DocumentEditorTextRun,
  resources: DocumentResources,
  availableWidth: number,
): InlineImageDimensions {
  const resource = run.image ? resources.images.get(run.image.url) ?? null : null;
  const authoredWidth = run.image?.width ?? null;
  const fallbackWidth = Math.min(availableWidth, authoredWidth ?? 240);
  const fallbackHeight = Math.max(120, Math.round(fallbackWidth * 9 / 16));

  if (!resource || resource.intrinsicWidth <= 0 || resource.intrinsicHeight <= 0) {
    return {
      height: fallbackHeight,
      width: fallbackWidth,
    };
  }

  const targetWidth = Math.min(availableWidth, authoredWidth ?? resource.intrinsicWidth);
  const scale = Math.min(1, targetWidth / resource.intrinsicWidth);

  return {
    height: Math.max(48, Math.round(resource.intrinsicHeight * scale)),
    width: Math.max(48, Math.round(resource.intrinsicWidth * scale)),
  };
}

export function resolveInlineImageSignature(
  run: DocumentEditorTextRun,
  resources: DocumentResources,
) {
  if (!run.image) {
    return `${run.kind}:missing-image`;
  }

  const resource = resources.images.get(run.image.url);

  return `${run.kind}:${run.image.url}:${run.image.width ?? 0}:${resource?.status ?? "loading"}:${resource?.intrinsicWidth ?? 0}:${resource?.intrinsicHeight ?? 0}`;
}
