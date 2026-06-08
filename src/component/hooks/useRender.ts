import { useEffect, useEffectEvent, useRef } from "react";
import type { ActiveEditorEffect } from "@/renderer";
import { recordFpsFrame } from "../lib/diagnostics";

type UseRenderOptions = {
  hasAmbientAnimationsInViewport?: () => boolean;
  isActive?: () => boolean;
  renderContent: (activeEffects: readonly ActiveEditorEffect[]) => ContentPaintResult;
  renderOverlay: () => void;
  renderViewport: (activeEffects: readonly ActiveEditorEffect[]) => ContentPaintResult;
};

type ContentPaintResult = {
  activeEffects: readonly ActiveEditorEffect[];
};

const noActiveContentEffects: ContentPaintResult = {
  activeEffects: [],
};

type RenderController = {
  scheduleFullRender: () => void;
  scheduleFullPaint: () => void;
  scheduleContentPaint: (options?: ScheduleContentPaintOptions) => void;
  scheduleOverlayPaint: () => void;
};

type ScheduleContentPaintOptions = {
  effects?: readonly ActiveEditorEffect[];
};

type PendingRenderIntents = {
  fullRender: boolean;
  fullPaint: boolean;
  contentPaint: boolean;
  overlayPaint: boolean;
};

function createPendingRenderIntents(): PendingRenderIntents {
  return {
    fullRender: false,
    fullPaint: false,
    contentPaint: false,
    overlayPaint: false,
  };
}

export function useRender({
  hasAmbientAnimationsInViewport,
  isActive,
  renderContent,
  renderOverlay,
  renderViewport,
}: UseRenderOptions): RenderController {
  /* Render state */

  const frameIdRef = useRef<number | null>(null);
  const activeEffectsRef = useRef<readonly ActiveEditorEffect[]>([]);
  const pendingIntentsRef = useRef(createPendingRenderIntents());

  /* Frame request */

  const requestFrame = useEffectEvent(() => {
    if (frameIdRef.current !== null) {
      return;
    }

    frameIdRef.current = window.requestAnimationFrame((frameTimestamp) => {
      flushRenderRequests(frameTimestamp);
    });
  });

  const paintContent = useEffectEvent(() => {
    const contentPaint = renderContent(activeEffectsRef.current);
    activeEffectsRef.current = contentPaint.activeEffects;
    return contentPaint;
  });

  /* Frame flush */

  const flushRenderRequests = useEffectEvent((frameTimestamp: number) => {
    frameIdRef.current = null;

    const pending = pendingIntentsRef.current;
    const shouldFullRender = pending.fullRender;
    const shouldFullPaint = pending.fullPaint;
    const shouldContentPaint = pending.contentPaint;
    const shouldOverlayPaint = pending.overlayPaint;

    pendingIntentsRef.current = createPendingRenderIntents();
    const renderStartedAt =
      process.env.NODE_ENV !== "production" ? performance.now() : frameTimestamp;

    if (shouldFullRender) {
      const contentPaint = renderViewport(activeEffectsRef.current);
      activeEffectsRef.current = contentPaint.activeEffects;
      if (process.env.NODE_ENV !== "production") {
        recordFpsFrame(performance.now() - renderStartedAt);
      }
      schedulePaintContinuation(contentPaint);
      return;
    }

    if (shouldFullPaint) {
      const contentPaint = paintContent();
      renderOverlay();
      if (process.env.NODE_ENV !== "production") {
        recordFpsFrame(performance.now() - renderStartedAt);
      }
      schedulePaintContinuation(contentPaint);
      return;
    }

    const painted = shouldContentPaint || shouldOverlayPaint;

    if (shouldContentPaint) {
      const contentPaint = paintContent();
      schedulePaintContinuation(contentPaint);
    }
    if (shouldOverlayPaint) {
      renderOverlay();
    }

    if (painted) {
      if (process.env.NODE_ENV !== "production") {
        recordFpsFrame(performance.now() - renderStartedAt);
      }
    }
  });

  /* Paint continuation */

  const schedulePaintContinuation = useEffectEvent(
    (contentPaint: ContentPaintResult = noActiveContentEffects) => {
      if (contentPaint.activeEffects.length > 0) {
        pendingIntentsRef.current.contentPaint = true;
        requestFrame();
        return;
      }

      if (isActive?.() === true || hasAmbientAnimationsInViewport?.() !== true) {
        return;
      }

      pendingIntentsRef.current.contentPaint = true;
      requestFrame();
    },
  );

  /* Lifecycle */

  useEffect(() => {
    return () => {
      if (frameIdRef.current === null) {
        return;
      }

      window.cancelAnimationFrame(frameIdRef.current);
      frameIdRef.current = null;
    };
  }, []);

  /* Public API */

  const scheduleFullRender = useEffectEvent(() => {
    pendingIntentsRef.current.fullRender = true;
    requestFrame();
  });

  const scheduleFullPaint = useEffectEvent(() => {
    pendingIntentsRef.current.fullPaint = true;
    requestFrame();
  });

  const scheduleContentPaint = useEffectEvent((options?: ScheduleContentPaintOptions) => {
    if (options?.effects && options.effects.length > 0) {
      activeEffectsRef.current = [...activeEffectsRef.current, ...options.effects];
    }

    pendingIntentsRef.current.contentPaint = true;
    requestFrame();
  });

  const scheduleOverlayPaint = useEffectEvent(() => {
    pendingIntentsRef.current.overlayPaint = true;
    requestFrame();
  });

  return {
    scheduleContentPaint,
    scheduleFullPaint,
    scheduleFullRender,
    scheduleOverlayPaint,
  };
}
