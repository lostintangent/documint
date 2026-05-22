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

type LeafAnchorPlacement = {
  horizontalOffset: number;
  verticalPlacement: "above" | "below";
};

const DEFAULT_PLACEMENT: LeafAnchorPlacement = {
  horizontalOffset: 0,
  verticalPlacement: "below",
};

export function LeafAnchor({ anchor, children }: LeafAnchorProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<LeafAnchorPlacement>(DEFAULT_PLACEMENT);

  // Flip the leaf above the anchor and horizontally shift it when it would
  // overflow the visible viewport (cursor near doc edges, iOS keyboard up, etc.).
  // Equality-checked setState keeps steady-state ResizeObserver fires from
  // churning renders unless placement actually changes.
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    const evaluatePlacement = () => {
      const shellBounds = shell.getBoundingClientRect();
      const nextPlacement = resolveLeafPlacement(anchor, shellBounds);

      setPlacement((current) =>
        arePlacementsEqual(current, nextPlacement) ? current : nextPlacement,
      );
    };

    evaluatePlacement();

    // Re-evaluate on the two inputs that change the decision: shell size
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
  }, [anchor.left, anchor.top]);

  return (
    <OverlayPortal>
      <div
        className="documint-leaf-anchor"
        data-bridge={anchor.bridge}
        data-placement={placement.verticalPlacement}
        onPointerEnter={anchor.onPointerEnter}
        onPointerLeave={anchor.onPointerLeave}
        style={
          {
            left: `${anchor.left + placement.horizontalOffset}px`,
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

function resolveLeafPlacement(anchor: LeafResolution, shellBounds: DOMRect): LeafAnchorPlacement {
  const visualVp = window.visualViewport;
  const visibleWidth = visualVp?.width ?? window.innerWidth;
  const visibleHeight = visualVp?.height ?? window.innerHeight;
  const visualOffsetLeft = visualVp?.offsetLeft ?? 0;
  const visualOffsetTop = visualVp?.offsetTop ?? 0;
  // Anchor coordinates are doc-absolute; convert to visible-viewport
  // relative to ask where the shell fits.
  const anchorScreenLeft = anchor.left - window.scrollX - visualOffsetLeft;
  const anchorScreenTop = anchor.top - window.scrollY - visualOffsetTop;
  const spaceBelow = visibleHeight - anchorScreenTop;

  return {
    horizontalOffset: resolveHorizontalOffset({
      anchorScreenLeft,
      shellWidth: shellBounds.width,
      visibleWidth,
    }),
    verticalPlacement: shellBounds.height + LEAF_BRIDGE_HEIGHT > spaceBelow ? "above" : "below",
  };
}

function resolveHorizontalOffset({
  anchorScreenLeft,
  shellWidth,
  visibleWidth,
}: {
  anchorScreenLeft: number;
  shellWidth: number;
  visibleWidth: number;
}): number {
  const spaceRight = visibleWidth - anchorScreenLeft;

  if (shellWidth <= spaceRight) {
    return 0;
  }

  return Math.max(
    -anchorScreenLeft,
    Math.min(-shellWidth / 2, visibleWidth - anchorScreenLeft - shellWidth),
  );
}

function arePlacementsEqual(left: LeafAnchorPlacement, right: LeafAnchorPlacement): boolean {
  return (
    left.horizontalOffset === right.horizontalOffset &&
    left.verticalPlacement === right.verticalPlacement
  );
}
