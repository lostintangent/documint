export {
  carryComments,
  createCommentThreadForSelection,
  getCommentState,
  hasActiveCommentHighlightsInViewport,
  resolveActiveCommentIndex,
  type CommentChange,
  type EditorCommentRange,
  type EditorCommentState,
} from "./comments";

export { resolveNodeAnchors, resolveNodeAnchorForPath, type EditorNodeAnchor } from "./nodes";

export {
  createSelectionAnchor,
  hasSelectionAnchorTextContinuity,
  resolveSelectionAnchor,
  type SelectionAnchor,
  type SelectionAnchorAffinity,
} from "./selection";

export {
  resolvePresenceTargets,
  type DocumentPresence,
  type DocumentUser,
  type DocumentUserPresence,
  type EditorPresence,
  type EditorPresenceViewport,
} from "./presence";

export { resolveCursorViewportStatus, resolvePresenceViewport } from "./presence/viewport";
