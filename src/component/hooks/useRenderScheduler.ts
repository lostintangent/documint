import { useEffect, useEffectEvent, useRef } from "react";

export type RenderMode = "viewport" | "content" | "overlay";

type UseRenderSchedulerOptions = {
  hasRunningAnimations?: () => boolean;
  renderContent: () => void;
  renderOverlay: () => void;
  renderViewport: () => void;
};

type RenderScheduler = {
  scheduleRender: (mode: RenderMode) => void;
};

/**
 * Coalesces viewport, content, and overlay paint requests into a single
 * animation-frame scheduler so multiple host invalidations do not trigger
 * duplicate work. Viewport renders subsume any pending content or overlay
 * repaint, while content renders can absorb a pending overlay repaint in the
 * same frame.
 */
export function useRenderScheduler({
  hasRunningAnimations,
  renderContent,
  renderOverlay,
  renderViewport,
}: UseRenderSchedulerOptions): RenderScheduler {
  const frameIdRef = useRef<number | null>(null);
  const pendingViewportRef = useRef(false);
  const pendingContentRef = useRef(false);
  const pendingOverlayRef = useRef(false);

  const requestFrame = useEffectEvent(() => {
    if (typeof window === "undefined" || frameIdRef.current !== null) {
      return;
    }

    frameIdRef.current = window.requestAnimationFrame(() => {
      flushRenderRequests();
    });
  });

  const scheduleAnimationContinuation = useEffectEvent(() => {
    if (!hasRunningAnimations?.()) {
      return;
    }

    pendingContentRef.current = true;
    requestFrame();
  });

  const flushRenderRequests = useEffectEvent(() => {
    frameIdRef.current = null;

    const shouldRenderViewport = pendingViewportRef.current;
    const shouldRenderContent = pendingContentRef.current;
    const shouldRenderOverlay = pendingOverlayRef.current;

    pendingViewportRef.current = false;
    pendingContentRef.current = false;
    pendingOverlayRef.current = false;

    if (shouldRenderViewport) {
      renderViewport();
      scheduleAnimationContinuation();
      return;
    }

    if (shouldRenderContent) {
      renderContent();

      if (shouldRenderOverlay) {
        renderOverlay();
      }

      scheduleAnimationContinuation();
      return;
    }

    if (shouldRenderOverlay) {
      renderOverlay();
    }
  });

  const scheduleRender = useEffectEvent((mode: RenderMode) => {
    if (typeof window === "undefined") {
      switch (mode) {
        case "viewport":
          renderViewport();
          return;
        case "content":
          renderContent();
          return;
        case "overlay":
          renderOverlay();
          return;
      }
    }

    switch (mode) {
      case "viewport":
        pendingViewportRef.current = true;
        break;
      case "content":
        pendingContentRef.current = true;
        break;
      case "overlay":
        pendingOverlayRef.current = true;
        break;
    }

    requestFrame();
  });

  useEffect(() => {
    return () => {
      if (typeof window === "undefined" || frameIdRef.current === null) {
        return;
      }

      window.cancelAnimationFrame(frameIdRef.current);
      frameIdRef.current = null;
    };
  }, []);

  return {
    scheduleRender,
  };
}
