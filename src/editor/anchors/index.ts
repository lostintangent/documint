export {
  createCommentThreadForSelection,
  getCommentState,
  hasActiveCommentHighlightsInViewport,
  resolveActiveCommentIndex,
  resolveCommentThreadViewportPosition,
  updateCommentThreadsForPathEdit,
  type EditorCommentRange,
  type EditorCommentState,
} from "./comments";

export {
  createNodeAnchorForPath,
  resolveNodeAnchor,
  resolveNodeAnchors,
  resolveNodeAnchorForPath,
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
