import { useEffect, useRef } from "react";
import type { DocumentFrame } from "@/renderer";
import { RENDER_FRAME_EVENT, type RenderFrameEvent } from "@/component/lib/diagnostics";

type DocumentFrameLine = DocumentFrame["lines"][number];
type DebugRect = { height: number; left: number; top: number; width: number };
type DebugRectRow = {
  fillStyle: string | null;
  rect: DebugRect;
  strokeStyle: string;
};
type DebugLinePhase = (line: DocumentFrameLine) => Iterable<DebugRectRow>;
type DebugPhase = (frame: DocumentFrame) => Iterable<DebugRectRow>;

const debugColors = {
  activeBlock: {
    fill: "rgba(239, 68, 68, 0.12)",
    stroke: "rgba(239, 68, 68, 0.78)",
  },
  activeTableBand: {
    fill: "rgba(239, 68, 68, 0.10)",
    stroke: "rgba(239, 68, 68, 0.72)",
  },
  activeTableBorder: "rgba(239, 68, 68, 0.9)",
  blockquoteRule: {
    fill: "rgba(14, 165, 233, 0.14)",
    stroke: "rgba(14, 165, 233, 0.86)",
  },
  comment: {
    fill: "rgba(249, 115, 22, 0.18)",
    stroke: "rgba(249, 115, 22, 0.86)",
  },
  container: {
    fill: "rgba(34, 197, 94, 0.10)",
    stroke: "rgba(34, 197, 94, 0.72)",
  },
  dividerRule: "rgba(148, 163, 184, 0.82)",
  headingRule: {
    fill: "rgba(99, 102, 241, 0.12)",
    stroke: "rgba(99, 102, 241, 0.86)",
  },
  lineBounds: "rgba(14, 165, 233, 0.55)",
  listMarker: {
    fill: "rgba(22, 163, 74, 0.12)",
    stroke: "rgba(22, 163, 74, 0.86)",
  },
  selection: {
    fill: "rgba(234, 179, 8, 0.18)",
    stroke: "rgba(234, 179, 8, 0.86)",
  },
} as const;
const textSegmentStrokeByAtom = {
  image: "rgba(168, 85, 247, 0.86)",
  "inline-code": "rgba(99, 102, 241, 0.82)",
  mention: "rgba(236, 72, 153, 0.86)",
  resource: "rgba(20, 184, 166, 0.86)",
  text: "rgba(59, 130, 246, 0.44)",
} satisfies Record<DocumentFrame["lines"][number]["segments"][number]["atom"], string>;
const debugPhases: readonly DebugPhase[] = [
  mapFrameLines(lineBounds),
  mapFrameLines(lineBackgrounds),
  mapFrameLines(lineRanges),
  mapFrameLines(textSegments),
  mapFrameLines(listMarkers),
  chrome,
] as const;

export function FrameDebugOverlay({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestRenderFrameRef = useRef<RenderFrameEvent | null>(null);

  useEffect(() => {
    const handleRenderFrame = (event: Event) => {
      const detail = (event as CustomEvent<RenderFrameEvent>).detail;

      latestRenderFrameRef.current = detail;
      paintDebugOverlay(canvasRef.current, detail);
    };

    window.addEventListener(RENDER_FRAME_EVENT, handleRenderFrame);

    return () => {
      window.removeEventListener(RENDER_FRAME_EVENT, handleRenderFrame);
    };
  }, []);

  useEffect(() => {
    if (enabled) {
      paintDebugOverlay(canvasRef.current, latestRenderFrameRef.current);
    }
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  return <canvas aria-hidden="true" className="pointer-events-none fixed z-[30]" ref={canvasRef} />;
}

function paintDebugOverlay(canvas: HTMLCanvasElement | null, renderFrame: RenderFrameEvent | null) {
  if (!canvas || !renderFrame) {
    return;
  }

  const context = prepareDebugCanvas(canvas, renderFrame);

  for (const phase of debugPhases) {
    for (const row of phase(renderFrame.frame)) {
      paintDebugRectRow(context, row);
    }
  }
}

function prepareDebugCanvas(canvas: HTMLCanvasElement, renderFrame: RenderFrameEvent) {
  const sourceCanvas = renderFrame.canvas;
  const bounds = sourceCanvas.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);

  if (canvas.width !== sourceCanvas.width || canvas.height !== sourceCanvas.height) {
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
  }

  canvas.style.left = `${bounds.left}px`;
  canvas.style.top = `${bounds.top}px`;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const context = canvas.getContext("2d")!;

  context.setTransform(sourceCanvas.width / width, 0, 0, sourceCanvas.height / height, 0, 0);
  context.clearRect(0, 0, width, height);
  context.translate(0, -renderFrame.frame.layer.paintTop);
  context.lineWidth = 1;

  return context;
}

function mapFrameLines(linePhase: DebugLinePhase): DebugPhase {
  return function* frameLinePhase(frame) {
    for (const line of frame.lines) {
      yield* linePhase(line);
    }
  };
}

function* lineBounds(line: DocumentFrameLine): Iterable<DebugRectRow> {
  yield debugStroke(debugColors.lineBounds, line.layoutLine);
}

function* lineBackgrounds(line: DocumentFrameLine): Iterable<DebugRectRow> {
  if (line.activeBlockBackground) {
    yield debugFill(debugColors.activeBlock, line.activeBlockBackground.rect);
  }
  if (line.containerBackground) {
    yield debugFill(debugColors.container, line.containerBackground.rect);
  }
}

function* lineRanges(line: DocumentFrameLine): Iterable<DebugRectRow> {
  if (line.selectionHighlight) {
    yield debugFill(debugColors.selection, line.selectionHighlight);
  }
  for (const comment of line.commentHighlights) {
    yield debugFill(debugColors.comment, comment.rect);
  }
}

function* textSegments(line: DocumentFrameLine): Iterable<DebugRectRow> {
  for (const segment of line.segments) {
    yield debugStroke(textSegmentStrokeByAtom[segment.atom], {
      height: line.layoutLine.height,
      left: segment.left,
      top: line.layoutLine.top,
      width: segment.right - segment.left,
    });
  }
}

function* listMarkers(line: DocumentFrameLine): Iterable<DebugRectRow> {
  const marker = line.listMarker;
  if (!marker) {
    return;
  }

  if (marker.kind === "ordered") {
    yield debugFill(debugColors.listMarker, {
      height: 14,
      left: marker.anchorX - 14,
      top: marker.textBaseline - 12,
      width: 14,
    });
    return;
  }

  yield debugFill(debugColors.listMarker, marker.rect);
}

function* chrome(frame: DocumentFrame): Iterable<DebugRectRow> {
  const activeTableCellHighlight = frame.chrome.activeTableCellHighlight;

  if (activeTableCellHighlight) {
    for (const band of activeTableCellHighlight.bands) {
      yield debugFill(debugColors.activeTableBand, band);
    }
    yield debugStroke(debugColors.activeTableBorder, activeTableCellHighlight.borderRect);
  }

  for (const rule of frame.chrome.dividerRules) {
    yield debugStroke(debugColors.dividerRule, rule);
  }

  for (const rule of frame.chrome.headingRules.values()) {
    yield debugFill(debugColors.headingRule, rule);
  }

  for (const rule of frame.chrome.blockquoteRules.values()) {
    yield debugFill(debugColors.blockquoteRule, rule.rect);
  }
}

function debugFill(colors: { fill: string; stroke: string }, rect: DebugRect): DebugRectRow {
  return {
    fillStyle: colors.fill,
    rect,
    strokeStyle: colors.stroke,
  };
}

function debugStroke(strokeStyle: string, rect: DebugRect): DebugRectRow {
  return {
    fillStyle: null,
    rect,
    strokeStyle,
  };
}

function paintDebugRectRow(
  context: CanvasRenderingContext2D,
  { fillStyle, rect, strokeStyle }: DebugRectRow,
) {
  if (fillStyle) {
    context.fillStyle = fillStyle;
    context.fillRect(rect.left, rect.top, rect.width, rect.height);
  }

  context.strokeStyle = strokeStyle;
  context.strokeRect(rect.left, rect.top, rect.width, rect.height);
}
