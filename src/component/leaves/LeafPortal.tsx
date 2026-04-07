import type { PointerEventHandler, ReactNode } from "react";
import { createPortal } from "react-dom";

export type LeafPortalAnchor = {
  container?: Element | null;
  isSelection?: boolean;
  left: number;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  top: number;
};

type LeafPortalProps = {
  anchor: LeafPortalAnchor;
  children: ReactNode;
  className?: string;
  status?: "default" | "resolved";
};

export function LeafPortal({
  anchor,
  children,
  className,
  status = "default",
}: LeafPortalProps) {
  if (typeof document === "undefined") {
    return null;
  }

  const portalContainer = anchor.container ?? document.body;
  const showBridge = !anchor.isSelection;
  const shellClassName = className
    ? `documint-leaf-shell ${className}`
    : "documint-leaf-shell";

  return createPortal(
    <div
      className="documint-leaf-anchor"
      data-selection={anchor.isSelection ? "true" : "false"}
      onPointerEnter={anchor.onPointerEnter}
      onPointerLeave={anchor.onPointerLeave}
      style={{
        left: `${anchor.left}px`,
        top: `${anchor.top}px`,
      }}
    >
      {showBridge ? <div className="documint-leaf-bridge" /> : null}
      <div
        className={shellClassName}
        data-status={status}
      >
        {children}
      </div>
    </div>,
    portalContainer,
  );
}
