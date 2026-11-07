// Positions the active document leaf against the rendered layout. It reads
// `renderedLayoutSprig` reactively, so the anchor follows each commit without
// `Documint` re-rendering for layout changes. Geometry must come from this
// reactive source: the React Compiler memoizes render-body store reads such as
// `layout.get()` on the stable store identity, so they would go stale.

import type { ReactNode, RefObject } from "react";
import { measureVisualCaret } from "@/editor";
import { useSprig } from "../../store/react";
import { renderedLayoutSprig } from "../../store/layout/sprigs";
import { DocumentAnchor } from "./DocumentAnchor";
import type { DocumentAnchorResolution, DocumentAnchorTarget } from "../leaves/core/shared";

type DocumentLeafAnchorProps = {
  children: ReactNode;
  // Set only while the pointer is hovering this leaf, which enables the
  // hover bridge.
  hover: Pick<DocumentAnchorResolution, "onPointerEnter" | "onPointerLeave"> | null;
  scrollContainerRef: RefObject<HTMLElement | null>;
  target: DocumentAnchorTarget;
  viewportHeight: number;
  viewportTop: number;
};

export function DocumentLeafAnchor({
  children,
  hover,
  scrollContainerRef,
  target,
  viewportHeight,
  viewportTop,
}: DocumentLeafAnchorProps) {
  const renderedLayout = useSprig(renderedLayoutSprig);

  if (!renderedLayout) {
    return null;
  }

  const measured = measureVisualCaret(renderedLayout.layout, target.anchor)?.caret;
  if (!measured) {
    return null;
  }

  // Hide anchors whose bottom falls outside the visible window, the same gate
  // the canvas painter applies to the caret.
  const { bottom, top } = target.extentOverride ?? {
    bottom: measured.top + measured.height,
    top: measured.top,
  };
  if (bottom <= viewportTop || bottom >= viewportTop + viewportHeight) {
    return null;
  }

  // Scroll-container coords. `DocumentAnchor` maps them to document space
  // after commit, which keeps this render free of DOM reads.
  const anchor: DocumentAnchorResolution = {
    anchorHeight: bottom - top,
    bridge: hover !== null,
    left: target.leftOverride ?? measured.left,
    onPointerEnter: hover?.onPointerEnter,
    onPointerLeave: hover?.onPointerLeave,
    paddingY: target.paddingY ?? 0,
    top: bottom - viewportTop,
  };

  return (
    <DocumentAnchor anchor={anchor} origin={scrollContainerRef}>
      {children}
    </DocumentAnchor>
  );
}
