// Positions the active document leaf against the rendered layout. It reads
// `renderedLayoutSprig` reactively, so the anchor follows each commit without
// `Documint` re-rendering for layout changes. Geometry must come from this
// reactive source: the React Compiler memoizes render-body store reads such as
// `layout.get()` on the stable store identity, so they would go stale.

import type { ReactNode, RefObject } from "react";
import { measureVisualCaretTarget, type EditorState } from "@/editor";
import { useSprig } from "../../store/react";
import { renderedLayoutSprig } from "../../store/layout/sprigs";
import { DocumentAnchor } from "./DocumentAnchor";
import type { DocumentAnchorResolution, DocumentAnchorTarget } from "../leaves/core/shared";

type DocumentLeafAnchorProps = {
  children: ReactNode;
  editorState: EditorState;
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
  editorState,
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

  const measured = measureVisualCaretTarget(editorState, renderedLayout, target.anchor);
  if (!measured) {
    return null;
  }

  // Hide anchors whose line falls outside the visible window, the same gate
  // the canvas painter applies to the caret.
  const anchorBottom = measured.top + measured.height;
  const viewportBottom = viewportTop + viewportHeight;
  if (anchorBottom <= viewportTop || anchorBottom >= viewportBottom) {
    return null;
  }

  // Scroll-container coords. `DocumentAnchor` maps them to document space
  // after commit, which keeps this render free of DOM reads.
  const anchor: DocumentAnchorResolution = {
    anchorHeight: measured.height,
    bridge: hover !== null,
    left: target.leftOverride ?? measured.left,
    onPointerEnter: hover?.onPointerEnter,
    onPointerLeave: hover?.onPointerLeave,
    paddingY: target.paddingY ?? 0,
    top: anchorBottom - viewportTop,
  };

  return (
    <DocumentAnchor anchor={anchor} origin={scrollContainerRef}>
      {children}
    </DocumentAnchor>
  );
}
