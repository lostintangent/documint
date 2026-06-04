// Anchor for fixed editor chrome (search leaf + presence indicators) at
// the editor's top-right. Both chrome pieces are portaled through
// `OverlayPortal` so they share the same shadow root and stylesheet as
// `DocumentAnchor` consumers.
//
// An in-place sticky sentinel sits inside the editor's scroll container
// as a geometry source — the portal mirrors the sentinel's rect into the
// shadow root so the chrome visually pins to the editor's top-right
// across scroll and resize. Co-locating the leaf and presence indicators
// in one portaled flex column keeps their open/close coordination
// internal: the leaf's height animation shifts presence indicators down
// via natural flex layout, with no caller-side wiring required.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { EditorPresence } from "@/editor";
import { OverlayPortal } from "../OverlayPortal";
import { PresenceIndicator } from "../PresenceIndicator";

type ViewportAnchorProps = {
  // Optional animated leaf (currently always SearchLeaf).
  children?: ReactNode;
  open: boolean;

  // Presence indicators rendered below the leaf (pass `undefined` when
  // there are no remote users to display).
  presence: EditorPresence[] | undefined;
  onPresenceSelect: (presence: EditorPresence) => void;

  // Theme-derived chrome insets.
  paddingX: number;
  paddingY: number;
};

const animationMs = 500;
// Gap reserved below the leaf so the presence indicators clear its shadow
// while the leaf itself slides independently.
const clearancePx = 12;
// Sits above the document-anchored leaves' default but stays well below
// the OverlayPortal host's `2147483647` so it can't escape the editor.
const zIndex = 1050;

type LeafSize = {
  height: number;
  width: number;
};

// Mirror of the in-place sentinel's geometry, in document coordinates.
type Geometry = {
  top: number;
  left: number;
  width: number;
};

export function ViewportAnchor({
  children,
  open,
  presence,
  onPresenceSelect,
  paddingX,
  paddingY,
}: ViewportAnchorProps) {
  const [isPresent, setIsPresent] = useState(open);
  const [isVisible, setIsVisible] = useState(false);
  const [leafSize, setLeafSize] = useState<LeafSize>({ height: 0, width: 0 });
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const renderedChildrenRef = useRef<ReactNode>(children);
  const hasPresence = presence !== undefined && presence.length > 0;

  if (open) {
    renderedChildrenRef.current = children;
  }

  useEffect(() => {
    if (open) {
      setIsPresent(true);
      setIsVisible(false);
      return;
    }

    setIsVisible(false);
    const timeoutId = window.setTimeout(() => setIsPresent(false), animationMs);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  useEffect(() => {
    if (!open || !isPresent) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => setIsVisible(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [isPresent, open]);

  useLayoutEffect(() => {
    if (!isPresent) {
      return;
    }

    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    const updateSize = () => {
      setLeafSize((current) => {
        const next = {
          height: shell.offsetHeight + clearancePx,
          width: shell.offsetWidth,
        };
        return current.height === next.height && current.width === next.width ? current : next;
      });
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(shell);
    return () => resizeObserver.disconnect();
  }, [isPresent]);

  // Mirror the in-place sentinel's rect into the portal. Doc coordinates
  // are stable across host-page scroll — `rect.top` shrinks as the page
  // scrolls down, but `window.scrollY` grows by the same amount, so the
  // doc-relative position doesn't need a scroll listener. ResizeObserver
  // + window-resize cover editor reflows and viewport changes; `paddingY`
  // is in deps so theme-driven inset changes re-evaluate the sticky-top
  // position.
  useLayoutEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const updateGeometry = () => {
      const rect = sentinel.getBoundingClientRect();
      setGeometry((current) => {
        const next: Geometry = {
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width,
        };
        return current &&
          current.top === next.top &&
          current.left === next.left &&
          current.width === next.width
          ? current
          : next;
      });
    };

    updateGeometry();
    const resizeObserver = new ResizeObserver(updateGeometry);
    resizeObserver.observe(sentinel);
    window.addEventListener("resize", updateGeometry);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateGeometry);
    };
  }, [paddingY]);

  const leafClassName = "overlay-leaf";
  const leafDataState = isVisible ? "open" : "closed";
  const leafStyle = {
    "--overlay-leaf-height": `${leafSize.height}px`,
    "--overlay-leaf-width": `${leafSize.width}px`,
  } as CSSProperties;

  return (
    <>
      {/* Sentinel: sticky at the editor's top-right, purely a geometry
          source for the portal mirror. Carries no visible content and
          reserves no space (zero height); the actual leaf and presence
          chrome render inside the portal below. */}
      <div
        ref={sentinelRef}
        aria-hidden="true"
        className="documint-viewport-anchor-sentinel"
        style={{ top: `${paddingY}px` }}
      />
      {(isPresent || hasPresence) && geometry && (
        <OverlayPortal>
          <div
            // Column flex container that right-aligns both children inside
            // the editor's content area (paddingX inset from the right
            // edge). `position: absolute` doc-coords float the wrapper over
            // the editor without participating in its layout.
            style={{
              position: "absolute",
              top: `${geometry.top}px`,
              left: `${geometry.left}px`,
              width: `${geometry.width}px`,
              paddingRight: `${paddingX}px`,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              boxSizing: "border-box",
              pointerEvents: "none",
              zIndex,
            }}
          >
            {isPresent && (
              <div className={leafClassName} data-state={leafDataState} style={leafStyle}>
                <div className="overlay-leaf-frame">
                  <div className="leaf-shell" ref={shellRef}>
                    {renderedChildrenRef.current}
                  </div>
                </div>
              </div>
            )}
            {presence && presence.length > 0 && (
              <div
                aria-label="Presence"
                className="flex flex-col items-end gap-1.5 pointer-events-none"
              >
                {presence.map((entry) => (
                  <PresenceIndicator
                    key={entry.id}
                    onSelect={() => onPresenceSelect(entry)}
                    presence={entry}
                  />
                ))}
              </div>
            )}
          </div>
        </OverlayPortal>
      )}
    </>
  );
}
