import { useEffect, useEffectEvent, useRef } from "react";
import { hasRunningAnimations } from "@/editor";
import { recordFpsFrame } from "../lib/diagnostics";
import { useDocumintStore } from "../store";

type UseRenderSchedulerOptions = {
  /** Whether optional content-layer animations should keep rAF paints running. */
  hasRunningOptionalContentAnimations?: () => boolean;
  /** Whether active user input should pause optional paint-only animations. */
  isActive?: () => boolean;
  /** Repaint the content layer using the cached viewport layout. */
  renderContent: () => void;
  /** Repaint the overlay layer (cursor, presence). */
  renderOverlay: () => void;
  /** Recompute layout, then repaint the content and overlay layers. */
  renderViewport: () => void;
};

type RenderScheduler = {
  /**
   * Recompute layout, then paint content and overlay. Use for changes that
   * affect layout structure (document, dimensions, theme). Subsumes any
   * pending paint requests in the same frame.
   */
  scheduleFullRender: () => void;
  /**
   * Paint content and overlay using the cached layout — no recompute. Use
   * when state changes affect both layers (e.g. selection moves, which
   * change both the range highlight on content and the caret on overlay).
   * Subsumes content-only and overlay-only paints in the same frame.
   */
  scheduleFullPaint: () => void;
  /**
   * Paint just the content layer. Use when state changes only affect content
   * (e.g. comment-highlight changes that don't move the caret).
   */
  scheduleContentPaint: () => void;
  /**
   * Paint just the overlay layer (cursor blink, presence indicators). The
   * cheapest mode — use when only the overlay is dirty.
   */
  scheduleOverlayPaint: () => void;
};

type PendingRenderRequests = {
  fullRender: boolean;
  fullPaint: boolean;
  contentPaint: boolean;
  overlayPaint: boolean;
};

function createPendingRenderRequests(): PendingRenderRequests {
  return {
    fullRender: false,
    fullPaint: false,
    contentPaint: false,
    overlayPaint: false,
  };
}

/**
 * Owns the rAF render loop for a Documint instance.
 *
 * The host's responsibilities are narrow:
 *   1. Provide one paint callback per layer.
 *   2. Call the schedule method that matches what changed. The verb encodes
 *      the cost: `Render` recomputes layout; `Paint` reuses the cached
 *      layout. The suffix names the layers: `Full` = content + overlay,
 *      `Content` = content only, `Overlay` = overlay only.
 *
 * Everything else lives here:
 *   - **Coalescing.** Multiple schedule calls within a tick produce one rAF.
 *     Heavier modes subsume lighter ones (full render > full paint > layer
 *     paints). Independent layer paints (content-only + overlay-only) can
 *     both fire in the same frame.
 *   - **Animation continuation.** After any layout-aware or content frame,
 *     the scheduler asks whether content-layer animations are still running
 *     and self-schedules a follow-up content paint if so. These animations
 *     never affect overlay, so the continuation never repaints overlay.
 *   - **Lifecycle.** Any in-flight rAF is cancelled on unmount.
 *
 * On the server, paint callbacks are dispatched synchronously.
 */
export function useRenderScheduler({
  hasRunningOptionalContentAnimations,
  isActive,
  renderContent,
  renderOverlay,
  renderViewport,
}: UseRenderSchedulerOptions): RenderScheduler {
  const store = useDocumintStore();
  const frameIdRef = useRef<number | null>(null);
  const pendingRef = useRef(createPendingRenderRequests());

  /* Public API */

  const scheduleFullRender = useEffectEvent(() => {
    if (typeof window === "undefined") {
      renderViewport();
      return;
    }
    pendingRef.current.fullRender = true;
    requestFrame();
  });

  const scheduleFullPaint = useEffectEvent(() => {
    if (typeof window === "undefined") {
      renderContent();
      renderOverlay();
      return;
    }
    pendingRef.current.fullPaint = true;
    requestFrame();
  });

  const scheduleContentPaint = useEffectEvent(() => {
    if (typeof window === "undefined") {
      renderContent();
      return;
    }
    pendingRef.current.contentPaint = true;
    requestFrame();
  });

  const scheduleOverlayPaint = useEffectEvent(() => {
    if (typeof window === "undefined") {
      renderOverlay();
      return;
    }
    pendingRef.current.overlayPaint = true;
    requestFrame();
  });

  /* Frame loop */

  // Ensures at most one rAF is outstanding at a time.
  const requestFrame = useEffectEvent(() => {
    if (typeof window === "undefined" || frameIdRef.current !== null) {
      return;
    }

    frameIdRef.current = window.requestAnimationFrame((frameTimestamp) => {
      flushRenderRequests(frameTimestamp);
    });
  });

  // The rAF callback. Drains pending bits and dispatches in priority order:
  // full render subsumes everything; full paint subsumes both layer paints;
  // content-only and overlay-only paints fire independently if both pending.
  const flushRenderRequests = useEffectEvent((frameTimestamp: number) => {
    frameIdRef.current = null;

    const pending = pendingRef.current;
    const shouldFullRender = pending.fullRender;
    const shouldFullPaint = pending.fullPaint;
    const shouldContentPaint = pending.contentPaint;
    const shouldOverlayPaint = pending.overlayPaint;

    pendingRef.current = createPendingRenderRequests();
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

  // After any layout-aware or content frame, keep the loop ticking while
  // the content layer has running animations. Overlay-only frames don't
  // trigger continuation: animations live on the content layer.
  const scheduleAnimationContinuation = useEffectEvent(() => {
    const hasRunningEditorAnimations = hasRunningAnimations(
      store.editor.getState(),
      performance.now(),
    );

    if (hasRunningEditorAnimations) {
      pendingRef.current.contentPaint = true;
      requestFrame();
      return;
    }

    if (isActive?.() === true || hasRunningOptionalContentAnimations?.() !== true) {
      return;
    }

    pendingRef.current.contentPaint = true;
    requestFrame();
  });

  // Cancel any in-flight frame on unmount so we don't paint into a torn-down
  // canvas.
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
    scheduleContentPaint,
    scheduleFullPaint,
    scheduleFullRender,
    scheduleOverlayPaint,
  };
}
