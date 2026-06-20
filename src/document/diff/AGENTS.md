# Document Diff

Document diff tells controlled-content sync which externally changed document nodes are safe to highlight. It compares a previous `Document` with the next `Document` and returns `DocumentChange` records for targetable additions or modifications. Today the only targets are whole blocks and table cells.

This is not a general markdown diff, an edit script, a renderer API, or sync lifecycle state. It is a bounded document-level detector. When the detector cannot identify a small, clear set of changed nodes, it returns no changes instead of guessing.

## Design Notes

- **`DocumentChange` is highlightable change information, not an edit script.** It records changed document targets that higher layers can resolve and display. It does not describe deletes, moves, unchanged nodes, text ranges, markdown operations, or undo steps.
- **Targets separate evidence from runtime lookup.** A `DocumentChangeTarget` carries a historical `DocumentNodeAnchor` for correspondence plus a `node` lookup projection such as path and block/table-cell ID for editor/render consumers. The anchor is the only retargeting evidence; `node` fields are projections of the snapshot where the target was created.
- **Content hashes recognize content, not identity.** Content hashes are one field inside node anchors. They can help find the same block or table cell after a reparse, but they are not durable identity and are not public comparison keys.
- **Paths are location clues, not anchors.** Paths are useful for direct lookup in one snapshot and for fallback matching, but insertions above a target can make an old path point at the wrong node. Do not treat paths as stable handles.
- **Detection is conservative.** The detector trims unchanged prefixes and suffixes, compares content hashes, uses small lookahead windows, and caps the amount of work. Broad rewrites, duplicate matches, too many targets, or exhausted budgets return no targets rather than partial or suspicious targets.
- **Retargeting only carries safe changes forward.** Existing unacknowledged changes are kept only when their current target has one clear match in the next document. Modified changes keep their original `previousTarget` so an added target does not turn into modified before the user acknowledges it.
- **Runtime resolution happens above this layer.** This subsystem never resolves editor selections, region IDs, renderer effects, React state, markdown strings, or acknowledgement queues. Component sync consumes `DocumentChange`, resolves editor targets, tracks acknowledgement, and drops changes that are no longer safe to show.

## Subsystem Map

- `index.ts` exports the public document-diff surface.
- `types.ts` defines `DocumentChange`, `DocumentChangeTarget`, and the added/modified vocabulary.
- `detect.ts` detects bounded additions and modifications between adjacent document snapshots.
- `targets.ts` creates targets, compares target clues, builds stable keys, and retargets existing changes into a later snapshot.
