export type VisualViewportMetrics = {
  height: number;
  offsetLeft: number;
  offsetTop: number;
  width: number;
};

export function getVisualViewportMetrics(): VisualViewportMetrics {
  const visualViewport = window.visualViewport;

  return {
    height: visualViewport?.height ?? window.innerHeight,
    offsetLeft: visualViewport?.offsetLeft ?? 0,
    offsetTop: visualViewport?.offsetTop ?? 0,
    width: visualViewport?.width ?? window.innerWidth,
  };
}

// `anchorViewportLeft` is relative to the visual viewport's left edge.
export function resolveHorizontalOffset({
  anchorViewportLeft,
  floatingWidth,
}: {
  anchorViewportLeft: number;
  floatingWidth: number;
}): number {
  const viewport = getVisualViewportMetrics();

  return Math.max(
    -anchorViewportLeft,
    Math.min(0, viewport.width - anchorViewportLeft - floatingWidth),
  );
}
