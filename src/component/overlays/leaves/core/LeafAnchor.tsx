// The leaf overlay primitive — a positioned, themed floating frame for
// any leaf-level surface (comment thread, link editor, table editor,
// insertion menu). Three visual layers:
//
//   1. OverlayPortal — host-app-defended placement, theme cascade
//   2. Anchor frame  — viewport positioning, optional hover bridge
//   3. Leaf shell    — bordered, shadowed container
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { OverlayPortal } from "../../OverlayPortal";
import type { LeafResolution } from "./shared";

// Pixel height of the hover bridge. JS-owned: written inline as
// `--documint-leaf-bridge-height` so styles.css has one source of truth.
export const LEAF_BRIDGE_HEIGHT = 12;

type LeafAnchorProps = {
  anchor: LeafResolution;
  children: ReactNode;
};

type Placement = "above" | "below";

export function LeafAnchor({ anchor, children }: LeafAnchorProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement>("below");

  // Flip the leaf above the anchor when below would overflow the visible
  // viewport (cursor near doc bottom, iOS keyboard up, etc.). Identity-
  // checked setState, so steady-state ResizeObserver fires don't churn
  // renders unless the placement actually changes.
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof window === "undefined") {
      return;
    }

    const evaluatePlacement = () => {
      const shellHeight = shell.getBoundingClientRect().height;
      const visualVp = window.visualViewport;
      const visibleHeight = visualVp?.height ?? window.innerHeight;
      const visualOffsetTop = visualVp?.offsetTop ?? 0;
      // `anchor.top` is doc-absolute; convert to visible-viewport-relative
      // to ask "is there room below?".
      const anchorScreenTop = anchor.top - window.scrollY - visualOffsetTop;
      const spaceBelow = visibleHeight - anchorScreenTop;

      setPlacement(shellHeight + LEAF_BRIDGE_HEIGHT > spaceBelow ? "above" : "below");
    };

    evaluatePlacement();

    // Re-evaluate on the two inputs that change the decision: shell height
    // (content resize) and screen space (visual viewport / window resize).
    // Page scroll deliberately doesn't — the leaf moves with the page
    // anyway, and flipping mid-scroll would be jarring.
    const resizeObserver = new ResizeObserver(evaluatePlacement);
    resizeObserver.observe(shell);
    window.visualViewport?.addEventListener("resize", evaluatePlacement);
    window.addEventListener("resize", evaluatePlacement);

    return () => {
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", evaluatePlacement);
      window.removeEventListener("resize", evaluatePlacement);
    };
  }, [anchor.top]);

  return (
    <OverlayPortal>
      <div
        className="documint-leaf-anchor"
        data-bridge={anchor.bridge}
        data-placement={placement}
        onPointerEnter={anchor.onPointerEnter}
        onPointerLeave={anchor.onPointerLeave}
        style={
          {
            left: `${anchor.left}px`,
            top: `${anchor.top}px`,
            "--documint-leaf-anchor-height": `${anchor.anchorHeight}px`,
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
