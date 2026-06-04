// Anchor that positions its content at a document-relative coordinate
// (caret or range location) via the shared `OverlayPortal`. Three visual
// layers stack inside:
//
//   1. OverlayPortal — shadow root + stylesheet, host-app isolation
//   2. Anchor frame  — viewport-aware placement, optional hover bridge
//   3. Leaf shell    — bordered, themed container for the leaf content
//
// Used by every document-anchored leaf (insertion, table, link,
// annotation, completion, comment thread). `ViewportAnchor` is its
// counterpart for fixed editor-chrome positioning.

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { equalShallowObject } from "../../store/core/equality";
import { OverlayPortal } from "../OverlayPortal";
import { getVisualViewportMetrics, resolveHorizontalOffset } from "./placement";
import type { DocumentAnchorResolution } from "../leaves/core/shared";

// Pixel height of the hover bridge. JS-owned: written inline as
// `--leaf-bridge-height` so overlays/styles.css has one source of truth.
export const LEAF_BRIDGE_HEIGHT = 12;

type DocumentAnchorProps = {
  anchor: DocumentAnchorResolution;
  children: ReactNode;
};

type DocumentAnchorPlacement = {
  horizontalOffset: number;
  verticalPlacement: "above" | "below";
};

type LeafShellSize = {
  height: number;
  width: number;
};

export function DocumentAnchor({ anchor, children }: DocumentAnchorProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const shellSizeRef = useRef<LeafShellSize | null>(null);
  const latestAnchorRef = useRef(anchor);
  const [placement, setPlacement] = useState<DocumentAnchorPlacement | null>(null);
  latestAnchorRef.current = anchor;

  // Hover-bridge pointer tracking. Native `pointerenter`/`pointerleave`
  // listeners (rather than React's `onPointerEnter`/`Leave` synthetic
  // events) because the anchor lives inside an `OverlayPortal`'s shadow
  // root: React's synthetic enter/leave are synthesized from
  // `pointerover`/`pointerout` at the React root, and events retargeted
  // across the shadow boundary don't always map back to the right fiber,
  // which breaks the bridge — the bridge's only role is to keep the
  // anchor's enter active while the pointer crosses the gap.
  const { onPointerEnter, onPointerLeave } = anchor;
  useLayoutEffect(() => {
    const anchorEl = anchorRef.current;
    if (!anchorEl || !onPointerEnter || !onPointerLeave) {
      return;
    }
    anchorEl.addEventListener("pointerenter", onPointerEnter);
    anchorEl.addEventListener("pointerleave", onPointerLeave);
    return () => {
      anchorEl.removeEventListener("pointerenter", onPointerEnter);
      anchorEl.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [onPointerEnter, onPointerLeave]);

  // Anchor moves reuse shell size cached by ResizeObserver, avoiding a
  // shell layout read on scroll-only updates.
  useLayoutEffect(() => {
    const shellSize = shellSizeRef.current;
    if (!shellSize) {
      return;
    }

    setPlacement((current) => {
      const next = resolvePlacement(anchor, shellSize);
      return current && equalShallowObject(current, next) ? current : next;
    });
  }, [anchor.left, anchor.top]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    const evaluatePlacement = () => {
      const bounds = shell.getBoundingClientRect();
      const shellSize = { height: bounds.height, width: bounds.width };
      shellSizeRef.current = shellSize;
      setPlacement((current) => {
        const next = resolvePlacement(latestAnchorRef.current, shellSize);
        return current && equalShallowObject(current, next) ? current : next;
      });
    };

    evaluatePlacement();

    // Screen-space changes can also alter fit/flip decisions. Page scroll is
    // handled by the anchor-move effect above, using the cached shell size.
    const resizeObserver = new ResizeObserver(evaluatePlacement);
    resizeObserver.observe(shell);
    window.addEventListener("resize", evaluatePlacement);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", evaluatePlacement);
    };
  }, []);

  return (
    <OverlayPortal>
      <div
        className="leaf-anchor"
        data-bridge={anchor.bridge}
        data-placement={placement?.verticalPlacement ?? "below"}
        data-placement-ready={placement ? "true" : "false"}
        ref={anchorRef}
        style={
          {
            "--leaf-anchor-height": `${anchor.anchorHeight}px`,
            "--leaf-anchor-left": placement
              ? `${anchor.left + placement.horizontalOffset}px`
              : "0px",
            "--leaf-anchor-top": placement ? `${anchor.top}px` : "0px",
            "--leaf-bridge-expand-left": placement
              ? `${Math.max(0, placement.horizontalOffset)}px`
              : "0px",
            "--leaf-bridge-expand-right": placement
              ? `${Math.max(0, -placement.horizontalOffset)}px`
              : "0px",
            "--leaf-bridge-height": `${LEAF_BRIDGE_HEIGHT}px`,
            "--leaf-padding-y": `${anchor.paddingY}px`,
          } as CSSProperties
        }
      >
        {anchor.bridge && <div className="leaf-bridge" />}
        <div className="leaf-shell" ref={shellRef}>
          {children}
        </div>
      </div>
    </OverlayPortal>
  );
}

function resolvePlacement(
  anchor: DocumentAnchorResolution,
  shellSize: LeafShellSize,
): DocumentAnchorPlacement {
  const viewport = getVisualViewportMetrics();
  // Anchor coordinates are doc-absolute; convert to visible-viewport
  // relative to ask where the shell fits.
  const anchorViewportLeft = anchor.left - window.scrollX - viewport.offsetLeft;
  const anchorViewportTop = anchor.top - window.scrollY - viewport.offsetTop;
  const spaceBelow = viewport.height - anchorViewportTop;
  const verticalGap = LEAF_BRIDGE_HEIGHT + anchor.paddingY;

  return {
    horizontalOffset: resolveHorizontalOffset({
      anchorViewportLeft,
      floatingWidth: shellSize.width,
    }),
    verticalPlacement: shellSize.height + verticalGap > spaceBelow ? "above" : "below",
  };
}
