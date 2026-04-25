/**
 * Small canvas-host helpers that keep render-specific details out of the main
 * component body.
 */
import type { DocumintState } from "../Documint";

export function resolveDevicePixelRatio() {
  if (typeof window === "undefined") {
    return 1;
  }

  return Math.max(1, window.devicePixelRatio || 1);
}

export function prepareCanvasLayer(
  canvas: HTMLCanvasElement | null,
  {
    paintHeight,
    paintTop,
    width,
  }: {
    paintHeight: number;
    paintTop: number;
    width: number;
  },
) {
  if (!canvas) {
    return null;
  }

  const height = Math.max(240, Math.ceil(paintHeight));
  const devicePixelRatio = resolveDevicePixelRatio();

  canvas.width = Math.ceil(width * devicePixelRatio);
  canvas.height = Math.ceil(height * devicePixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.transform = `translateY(${paintTop}px)`;

  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  return {
    context,
    devicePixelRatio,
    height,
    width,
  };
}

export function areStatesEqual(previous: DocumintState, next: DocumintState) {
  return (
    previous.activeBlockType === next.activeBlockType &&
    previous.activeCommentThreadIndex === next.activeCommentThreadIndex &&
    previous.activeSpanKind === next.activeSpanKind &&
    previous.canonicalContent === next.canonicalContent &&
    previous.characterCount === next.characterCount &&
    previous.commentThreadCount === next.commentThreadCount &&
    previous.layoutWidth === next.layoutWidth &&
    previous.resolvedCommentCount === next.resolvedCommentCount &&
    previous.selectionFrom === next.selectionFrom &&
    previous.selectionTo === next.selectionTo
  );
}
