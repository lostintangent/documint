// Fragment subsystem: editor-state policy for document `Fragment` values.
// Copy captures the current selection as a fragment; paste resolves a fragment
// into the lowest-altitude editor action that can apply it.

export { extractFragment } from "./extract";
export { resolvePasteFragmentAction, resolvePasteFragmentContext } from "./paste";
