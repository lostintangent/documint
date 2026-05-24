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

type LeafShellSize = {
  height: number;
  width: number;
};

const DEFAULT_PLACEMENT: LeafAnchorPlacement = {
  horizontalOffset: 0,
  verticalPlacement: "below",
};

export function LeafAnchor({ anchor, children }: LeafAnchorProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const shellSizeRef = useRef<LeafShellSize | null>(null);
  const latestAnchorRef = useRef(anchor);
  const [placement, setPlacement] = useState<LeafAnchorPlacement>(DEFAULT_PLACEMENT);
  latestAnchorRef.current = anchor;

  // Anchor moves reuse shell size cached by ResizeObserver, avoiding a
  // shell layout read on scroll-only updates.
  useLayoutEffect(() => {
    const shellSize = shellSizeRef.current;
    if (!shellSize) {
      return;
    }

    setPlacement((current) => {
      const next = resolveLeafPlacement(anchor, shellSize);
      return arePlacementsEqual(current, next) ? current : next;
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
        return arePlacementsEqual(current, next) ? current : next;
      });
    };

    evaluatePlacement();

    // Screen-space changes can also alter fit/flip decisions. Page scroll is
    // handled by the anchor-move effect above, using the cached shell size.
    const resizeObserver = new ResizeObserver(evaluatePlacement);
    resizeObserver.observe(shell);
    window.visualViewport?.addEventListener("resize", evaluatePlacement);
    window.addEventListener("resize", evaluatePlacement);

    return () => {
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", evaluatePlacement);
      window.removeEventListener("resize", evaluatePlacement);
    };
  }, []);

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

function resolveLeafPlacement(
  anchor: LeafResolution,
  shellSize: LeafShellSize,
): LeafAnchorPlacement {
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
      shellWidth: shellSize.width,
      visibleWidth,
    }),
    verticalPlacement: shellSize.height + LEAF_BRIDGE_HEIGHT > spaceBelow ? "above" : "below",
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
