// Apply a `Fragment` to the current selection. Each kind dispatches at
// its native altitude:
//
//   - `text`    → `splice-text` (the inline replace fast path).
//   - `inlines` → `replace-block` via `insertInlines` (a focused inline
//     splice in the destination's leaf — no block-level seam-merge).
//   - `blocks`  → `splice-fragment` (the structural seam-merge).
//
// Returns null when no application makes sense: the fragment is empty, or
// it lands on an opaque root that can't accept it. Code blocks reject all
// non-text fragments (their content is source text). Table cells reject
// `blocks` (a cell can't be split structurally) but accept `inlines`
// (cells *are* inline regions). Callers fall back to flattening when
// they want a non-null outcome.

import { createParagraphBlock, type Fragment } from "@/document";
import { insertInlines } from "../actions/inlines";
import { dispatch } from "../reducer/state";
import type { EditorState } from "../types";
import { resolveFragmentDestinationContext } from "./context";

export function applyFragment(state: EditorState, fragment: Fragment): EditorState | null {
  const destination = resolveFragmentDestinationContext(state.documentIndex, state.selection);

  if (!destination) {
    return null;
  }

  switch (fragment.kind) {
    case "text":
      return fragment.text.length > 0
        ? dispatch(state, {
            kind: "splice-text",
            selection: state.selection,
            text: fragment.text,
          })
        : null;

    case "inlines": {
      if (fragment.inlines.length === 0) {
        return null;
      }

      // Single-region inline paste: splice the inlines directly into the
      // destination leaf — no block-level splice, so the surrounding
      // container (list item, blockquote) stays intact.
      if (destination.sameRegion) {
        const action = insertInlines(state.documentIndex, state.selection, fragment.inlines);
        if (action) {
          return dispatch(state, action);
        }
      }

      // Cross-region or unsupported destination: synthesize a paragraph
      // and use the structural path. Opaque roots (code block, sub-table
      // selection) reject the same way `blocks` does.
      if (destination.structuralBlocked) {
        return null;
      }

      return dispatch(state, {
        kind: "splice-fragment",
        blocks: [createParagraphBlock({ children: fragment.inlines })],
        selection: state.selection,
      });
    }

    case "blocks":
      if (fragment.blocks.length === 0 || destination.structuralBlocked) {
        return null;
      }

      return dispatch(state, {
        kind: "splice-fragment",
        blocks: fragment.blocks,
        selection: state.selection,
      });
  }
}
