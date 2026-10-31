import { useEffect, useEffectEvent, useState } from "react";
import type { RendererEffect, RendererEffectInput } from "@/renderer";
import { recordFpsFrame } from "../lib/diagnostics";

type UseRenderOptions = {
  commitLayout: () => void;
  hasAmbientAnimationsInViewport: () => boolean;
  isActive: () => boolean;
  renderContent: (rendererEffects: readonly RendererEffect[]) => readonly RendererEffect[];
  renderOverlay: () => void;
};

type RenderController = {
  scheduleFullRender: () => void;
  scheduleFullPaint: () => void;
  scheduleContentPaint: (options?: ScheduleContentPaintOptions) => void;
  scheduleOverlayPaint: () => void;
};

type ScheduleContentPaintOptions = {
  effects?: readonly RendererEffectInput[];
};

export function useRender({
  commitLayout,
  hasAmbientAnimationsInViewport,
  isActive,
  renderContent,
  renderOverlay,
}: UseRenderOptions): RenderController {
  // The scheduler outlives renders, so it reaches the latest host callbacks
  // through Effect Events.
  const commit = useEffectEvent(() => commitLayout());
  const paintContent = useEffectEvent((rendererEffects: readonly RendererEffect[]) =>
    renderContent(rendererEffects),
  );
  const paintOverlay = useEffectEvent(() => renderOverlay());
  const isEditorActive = useEffectEvent(() => isActive());
  const hasAmbientAnimations = useEffectEvent(() => hasAmbientAnimationsInViewport());

  const [scheduler] = useState(() =>
    createRenderScheduler({
      commitLayout: commit,
      hasAmbientAnimationsInViewport: hasAmbientAnimations,
      isActive: isEditorActive,
      paintContent,
      paintOverlay,
      // Gated inline so production builds strip the FPS diagnostics.
      recordFrame: process.env.NODE_ENV !== "production" ? recordFpsFrame : undefined,
      requestFrame: (flush) => {
        const frameId = window.requestAnimationFrame(flush);
        return () => window.cancelAnimationFrame(frameId);
      },
    }),
  );

  useEffect(() => scheduler.cancel, [scheduler]);

  return scheduler;
}

type RenderSchedulerOptions = {
  commitLayout: () => void;
  hasAmbientAnimationsInViewport: () => boolean;
  isActive: () => boolean;
  paintContent: (rendererEffects: readonly RendererEffect[]) => readonly RendererEffect[];
  paintOverlay: () => void;
  recordFrame?: (durationMs: number) => void;
  // Requests one animation frame and returns a function that cancels it.
  requestFrame: (flush: () => void) => () => void;
};

type RenderIntents = {
  fullRender: boolean;
  fullPaint: boolean;
  contentPaint: boolean;
  overlayPaint: boolean;
};

// Coalesces render intents into at most one pending frame. Each frame commits
// layout for a full render, then paints content, then overlay, so `fullRender`
// subsumes `fullPaint`, which subsumes both partial paints. Content painting
// continues while renderer effects are active, and for ambient animations only
// while the editor is idle.
export function createRenderScheduler(options: RenderSchedulerOptions) {
  let pending = createRenderIntents();
  let rendererEffects: readonly RendererEffect[] = [];
  let cancelFrame: (() => void) | null = null;

  const schedule = (intent: keyof RenderIntents) => {
    pending[intent] = true;
    cancelFrame ??= options.requestFrame(flush);
  };

  const flush = () => {
    cancelFrame = null;
    const { fullRender, fullPaint, contentPaint, overlayPaint } = pending;
    pending = createRenderIntents();
    const startedAt = process.env.NODE_ENV !== "production" ? performance.now() : 0;

    if (fullRender) {
      options.commitLayout();
    }

    if (fullRender || fullPaint || contentPaint) {
      rendererEffects = options.paintContent(rendererEffects);

      if (
        rendererEffects.length > 0 ||
        (!options.isActive() && options.hasAmbientAnimationsInViewport())
      ) {
        schedule("contentPaint");
      }
    }

    if (fullRender || fullPaint || overlayPaint) {
      options.paintOverlay();
    }

    if (process.env.NODE_ENV !== "production") {
      options.recordFrame?.(performance.now() - startedAt);
    }
  };

  return {
    cancel: () => {
      cancelFrame?.();
      cancelFrame = null;
    },
    scheduleContentPaint: (paintOptions?: ScheduleContentPaintOptions) => {
      if (paintOptions?.effects && paintOptions.effects.length > 0) {
        const startedAt = performance.now();
        const effects = paintOptions.effects.map((effect) => ({ ...effect, startedAt }));
        rendererEffects = [...rendererEffects, ...effects];
      }

      schedule("contentPaint");
    },
    scheduleFullPaint: () => schedule("fullPaint"),
    scheduleFullRender: () => schedule("fullRender"),
    scheduleOverlayPaint: () => schedule("overlayPaint"),
  };
}

function createRenderIntents(): RenderIntents {
  return {
    fullRender: false,
    fullPaint: false,
    contentPaint: false,
    overlayPaint: false,
  };
}
