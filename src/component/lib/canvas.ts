/**
 * Small canvas-host helpers that keep render-specific details out of the main
 * component body.
 */

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
