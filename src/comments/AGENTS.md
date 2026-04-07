# Comments

This sub-system owns anchored review annotations. Its job is to define the persisted comment-thread shape, create and repair anchors against semantic document content, and keep comment-specific persistence and recovery logic out of `src/document`, `src/markdown`, and `src/editor`.

The two main responsibilities in this subsystem are:

- define the minimal persisted comment-thread schema
- create and repair anchored comments against semantic document containers

### Key Files

- `types.ts` - Owns the persisted comment vocabulary: threads, comments, anchors, repair results, and appendix diagnostics.

- `anchors.ts` - Owns comment target discovery, anchor construction, appendix parse/serialize, thread mutation helpers, and quote/context-based repair.

- `index.ts` - Owns the public comment API surface.

### Boundaries

- `src/comments` owns persisted comment semantics.
- `src/document` may carry `comments` on `Document`, but should not own comment repair or appendix policy.
- `src/markdown` owns comment appendix parsing and emission as markdown syntax, not comment meaning.
- `src/editor` owns runtime comment projection, hover/hit testing, paint integration, and local edit-time anchor maintenance.
- `src/component` owns DOM comment UI such as popovers and thread actions, not persistence or repair logic.

Keep the persisted schema minimal and human-readable. Favor a small stored anchor plus reliable live maintenance during edits over storing extra structural metadata in markdown.
