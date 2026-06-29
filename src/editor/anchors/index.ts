export {
  createCommentThreadForSelection,
  getCommentState,
  hasActiveCommentHighlightsInViewport,
  resolveActiveCommentIndex,
  resolveCommentThreadViewportPosition,
  updateCommentThreadsForRegionEdit,
  type EditorCommentRange,
  type EditorCommentState,
} from "./comments";

export {
  createNodeAnchorForRegion,
  resolveNodeAnchor,
  resolveNodeAnchors,
  resolveNodeAnchorForRegion,
  type EditorNodeAnchor,
} from "./nodes";

export {
  createSelectionAnchor,
  hasSelectionAnchorTextContinuity,
  resolveSelectionAnchor,
  type SelectionAnchor,
  type SelectionAnchorAffinity,
  type SelectionAnchorResolution,
} from "./selection";

export {
  resolvePresenceTargets,
  type EditorPresence,
  type EditorPresenceViewport,
  type EditorPresenceViewportStatus,
} from "./presence";

export { resolveCursorViewportStatus, resolvePresenceViewport } from "./presence/viewport";
