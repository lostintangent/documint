import { useEffect, useEffectEvent, useRef } from "react";
import { hasRunningAnimations as hasRunningEditorAnimations } from "@/editor";
import { recordFpsFrame } from "../lib/diagnostics";
import { useDocumintStore } from "../store";

type UseRenderOptions = {
  hasAmbientAnimationsInViewport?: () => boolean;
  isActive?: () => boolean;
  renderContent: () => void;
  renderOverlay: () => void;
  renderViewport: () => void;
};

type RenderController = {
  scheduleFullRender: () => void;
  scheduleFullPaint: () => void;
  scheduleContentPaint: () => void;
  scheduleOverlayPaint: () => void;
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

  const store = useDocumintStore();
  const frameIdRef = useRef<number | null>(null);
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
      renderViewport();
      if (process.env.NODE_ENV !== "production") {
        recordFpsFrame(performance.now() - renderStartedAt);
      }
      scheduleAnimationContinuation();
      return;
    }

    if (shouldFullPaint) {
      renderContent();
      renderOverlay();
      if (process.env.NODE_ENV !== "production") {
        recordFpsFrame(performance.now() - renderStartedAt);
      }
      scheduleAnimationContinuation();
      return;
    }

    const painted = shouldContentPaint || shouldOverlayPaint;

    if (shouldContentPaint) {
      renderContent();
      scheduleAnimationContinuation();
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

  /* Animation continuation */

  const scheduleAnimationContinuation = useEffectEvent(() => {
    const hasRunningEditorAnimation = hasRunningEditorAnimations(
      store.editor.getState(),
      performance.now(),
    );

    if (hasRunningEditorAnimation) {
      pendingIntentsRef.current.contentPaint = true;
      requestFrame();
      return;
    }

    if (isActive?.() === true || hasAmbientAnimationsInViewport?.() !== true) {
      return;
    }

    pendingIntentsRef.current.contentPaint = true;
    requestFrame();
  });

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

  const scheduleContentPaint = useEffectEvent(() => {
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
