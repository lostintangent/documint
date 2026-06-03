// The leaf overlay primitive — a positioned, themed floating frame for
// any leaf-level surface (comment thread, link editor, table editor,
// insertion menu). Three visual layers:
//
//   1. OverlayPortal — host-app-defended placement, theme cascade
//   2. Anchor frame  — viewport positioning, optional hover bridge
//   3. Leaf shell    — bordered, shadowed container
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { equalShallowObject } from "../../../../store/core/equality";
import { OverlayPortal } from "../../../OverlayPortal";
import { getVisualViewportMetrics, resolveHorizontalOffset } from "./placement";
import type { LeafAnchorResolution } from "../shared";

// Pixel height of the hover bridge. JS-owned: written inline as
// `--documint-leaf-bridge-height` so styles.css has one source of truth.
export const LEAF_BRIDGE_HEIGHT = 12;

type LeafAnchorProps = {
  anchor: LeafAnchorResolution;
  children: ReactNode;
};

type LeafAnchorPlacement = {
  horizontalOffset: number;
  verticalPlacement: "above" | "below";
};

type LeafShellSize = {
  height: number;
  width: number;
};

export function LeafAnchor({ anchor, children }: LeafAnchorProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const shellSizeRef = useRef<LeafShellSize | null>(null);
  const latestAnchorRef = useRef(anchor);
  const [placement, setPlacement] = useState<LeafAnchorPlacement | null>(null);
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
      const next = resolveLeafPlacement(anchor, shellSize);
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
        const next = resolveLeafPlacement(latestAnchorRef.current, shellSize);
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
        className="documint-leaf-anchor"
        data-bridge={anchor.bridge}
        data-placement={placement?.verticalPlacement ?? "below"}
        data-placement-ready={placement ? "true" : "false"}
        ref={anchorRef}
        style={
          {
            "--documint-leaf-anchor-height": `${anchor.anchorHeight}px`,
            "--documint-leaf-anchor-left": placement
              ? `${anchor.left + placement.horizontalOffset}px`
              : "0px",
            "--documint-leaf-anchor-top": placement ? `${anchor.top}px` : "0px",
            "--documint-leaf-bridge-expand-left": placement
              ? `${Math.max(0, placement.horizontalOffset)}px`
              : "0px",
            "--documint-leaf-bridge-expand-right": placement
              ? `${Math.max(0, -placement.horizontalOffset)}px`
              : "0px",
            "--documint-leaf-bridge-height": `${LEAF_BRIDGE_HEIGHT}px`,
            "--documint-leaf-padding-y": `${anchor.paddingY}px`,
          } as CSSProperties
        }
      >
        {anchor.bridge ? <div className="documint-leaf-bridge" /> : null}
        <div className="documint-leaf-shell" ref={shellRef}>
          {children}
        </div>
      </div>
    </OverlayPortal>
  );
}

function resolveLeafPlacement(
  anchor: LeafAnchorResolution,
  shellSize: LeafShellSize,
): LeafAnchorPlacement {
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
