// The leaf overlay primitive — renders content as a positioned, themed
// floating frame for any leaf-level surface (comment thread, link editor,
// table editor, insertion marker). Composes the three layers that together
// produce the visual identity of a leaf:
//
//   1. OverlayPortal — host-app-defended placement, theme cascade
//   2. Anchor frame  — viewport positioning, hover bridge for cursor travel
//   3. Leaf shell    — bordered, shadowed container with status styling
import type { PointerEventHandler, ReactNode } from "react";
import { OverlayPortal } from "../../OverlayPortal";

// Where + how a leaf overlay anchors to the editor surface.
export type LeafAnchor = {
  isSelection?: boolean;
  left: number;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  top: number;
};

type LeafAnchorViewProps = {
  anchor: LeafAnchor;
  children: ReactNode;
  status?: "default" | "resolved";
};

export function LeafAnchor({ anchor, children, status = "default" }: LeafAnchorViewProps) {
  const showBridge = !anchor.isSelection;

  return (
    <OverlayPortal>
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
        <div className="documint-leaf-shell" data-status={status}>
          {children}
        </div>
      </div>
    </OverlayPortal>
  );
}
