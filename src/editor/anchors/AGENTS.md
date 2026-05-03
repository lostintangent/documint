# Anchors

This sub-system owns the editor-side runtime support for the document layer's anchor algebra. The algebra itself — content-addressable position vocabulary, fingerprint capture/search/verification — lives in [`src/document`](../../document/AGENTS.md). Anchors here is what consumes that algebra to keep comment threads, presence cursors, and other anchored data live as the document changes.

Two costs drive the design:

- **Full re-resolve** is correct but expensive: it walks the document looking for fingerprint matches. Used when projecting persisted threads against a fresh document snapshot.
- **Edit-time remap** is cheap but local: when we know exactly what was edited, we can shift anchored offsets through the splice math directly, no fingerprint search needed. Used during typing to keep threads sticky without paying the full algebra cost per keystroke.

### Key Areas

- `index.ts` - Owns the cross-anchored-state projection helper (`projectAnchorContainersToEditor`) plus the public re-exports for comments, presence, and presence-viewport.

- `comments.ts` - Owns editor-side comment-thread state: capturing a thread from a live editor selection, projecting persisted threads against a snapshot to produce live runtime ranges, and edit-time repair via `remap.ts`.

- `presence.ts` - Owns resolution of host-provided presence cursors — placing each remote caret at a current document offset via the anchor algebra. Geometric placement (where it shows up on screen) is delegated to layout.

- `presence-viewport.ts` - Owns the small geometric layer on top of presence: computing whether a remote cursor sits above, below, or inside the current viewport, and the scroll-top that would bring it into view.

- `remap.ts` - Owns the cheap edit-time remap primitive: translates a stable `(start, end)` range through a known text edit. The complement to fingerprint-based resolution.
