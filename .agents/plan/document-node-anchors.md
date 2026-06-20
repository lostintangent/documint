# Document Node Anchors Plan

## Goal

Complete the uncommitted fingerprint work as a first-class `DocumentNodeAnchor` algebra.

The document model cannot persist durable node identities, so consumers need a whole-node counterpart to `TextAnchor`:

- `TextAnchor` locates spans inside semantic text containers.
- `DocumentNodeAnchor` locates whole semantic nodes by exact content evidence plus weak structural hints.
- Node anchors are evidence, not identity.

This first landing should make node anchors precise, inspectable, conservative, and hard to misuse. It should not introduce a full structural diff engine, move/delete detection, or content-absent modified-node recovery. Those can build later on top of a trusted node-anchor primitive.

The existing fingerprint feature is uncommitted, so there is no backward-compatibility alias layer. Replace fingerprint vocabulary with node-anchor vocabulary.

## Current Behavior

The document subsystem already distinguishes several locating concepts:

- Node IDs are snapshot-local handles. They can be cheap fast paths inside one canonical snapshot, but they are not durable identities.
- Paths are snapshot-local structural coordinates. They are useful location evidence, but inserts above a node can shift them.
- Text anchors are span-level content-addressable locators. The text-anchor substrate exposes primitives/candidates; comment resolution owns comment-specific scoring.
- The in-progress fingerprint code is a whole-node exact-content locator for blocks and table cells: `{ kind, contentHash }`.

The current fingerprint shape is safe but too thin. It cannot disambiguate repeated exact content by structural context, and the name describes an implementation detail rather than a document concept.

## Proposed Algebra

`DocumentNodeAnchor` is a snapshot-captured descriptor for one block or table cell. Its fields are split by evidence class so callers cannot confuse identity, location, and context.

```ts
export type DocumentNodeAnchor =
  | DocumentBlockAnchor
  | DocumentTableCellAnchor;

export type DocumentBlockAnchor = {
  readonly kind: "block";
  readonly node: {
    readonly hash: DocumentNodeContentHash;
    readonly type: Block["type"];
  };
  readonly path: string;
  readonly index: number;
  readonly parent: {
    readonly kind: "document" | "block";
    readonly type?: Block["type"];
  };
  readonly siblings: {
    readonly previousHash?: DocumentNodeContentHash;
    readonly nextHash?: DocumentNodeContentHash;
  };
};

export type DocumentTableCellAnchor = {
  readonly kind: "table-cell";
  readonly node: {
    readonly hash: DocumentNodeContentHash;
  };
  readonly path: string;
  readonly rowIndex: number;
  readonly columnIndex: number;
  readonly cells: {
    readonly previousHash?: DocumentNodeContentHash;
    readonly nextHash?: DocumentNodeContentHash;
  };
  readonly rows: {
    readonly previousHash?: DocumentNodeContentHash;
    readonly nextHash?: DocumentNodeContentHash;
  };
};
```

Important exclusions:

- No ID hint in the anchor. IDs remain snapshot-local runtime handles outside the content-addressable algebra.
- No text prefix/suffix windows. Text anchors already own span-level text context.
- No eager parent content hash in phase one. For nested blocks and large tables, parent hashes can be expensive and can include the anchored node itself.
- No `documentOrdinal` in phase one. It is global position evidence and too easy to misuse as fake identity.

`path`, row/column hints, and sibling hints are weak evidence. They can disambiguate exact-content duplicates only under the resolver rules below. They never become identity.

## Public API

The batched API is primary. Single-anchor resolution is only a convenience wrapper.

```ts
export type DocumentNodeAnchorResolution =
  | {
      readonly basis: "exact-content" | "exact-content-location" | "exact-content-context";
      readonly node: Block | TableCell;
      readonly path: string;
      readonly status: "matched";
    }
  | {
      readonly status: "absent";
    }
  | {
      readonly reason: "duplicate" | "weak-evidence";
      readonly status: "ambiguous";
    }
  | {
      readonly status: "exhausted";
    };

export type DocumentNodeAnchorResolveMode = "exact-content" | "contextual-content";

export function createDocumentNodeAnchor(
  document: Document,
  path: string,
): DocumentNodeAnchor | null;

export function findDocumentNodeAnchorCandidates(
  document: Document,
  anchor: DocumentNodeAnchor,
  options?: DocumentNodeAnchorResolveOptions,
): readonly DocumentNodeAnchorCandidate[];

export function resolveDocumentNodeAnchors(
  document: Document,
  anchors: readonly DocumentNodeAnchor[],
  options?: DocumentNodeAnchorResolveOptions,
): ReadonlyMap<string, DocumentNodeAnchorResolution>;

export function resolveDocumentNodeAnchor(
  document: Document,
  anchor: DocumentNodeAnchor,
  options?: DocumentNodeAnchorResolveOptions,
): DocumentNodeAnchorResolution;
```

`DocumentNodeAnchorResolveOptions` should include:

```ts
type DocumentNodeAnchorResolveOptions = {
  readonly maxVisitedNodes?: number;
  readonly mode?: DocumentNodeAnchorResolveMode;
};
```

Default mode should be `contextual-content` for new node-anchor callers. If a caller needs strict old fingerprint behavior during implementation, it can explicitly use `exact-content`, but no fingerprint alias API should remain.

## Resolution Rules

The resolver is a locator, not a structural diff engine. It resolves anchors only among candidates with the same exact content hash.

It does not recover nodes whose content hash changed. Modified-content correspondence is future work for a many-node structural correspondence pass.

Resolution is deterministic filtering, not fuzzy scoring:

1. Collect candidates with the same `kind` and `node.hash`.
1. For block anchors, require matching `node.type`.
1. If the candidate set is empty, return `absent`.
1. If the candidate set has one candidate, return `matched` with `basis: "exact-content"`.
1. If mode is `exact-content` and multiple candidates remain, return `ambiguous` with `reason: "duplicate"`.
1. If mode is `contextual-content`, try deterministic disambiguation:
   - Path is only a filter input. It is never an accepting condition by itself.
   - For blocks, accept only if exactly one candidate matches one of these evidence sets:
     - `path` plus at least one matching contextual signal: parent kind/type, previous sibling hash, or next sibling hash.
     - both previous and next sibling hashes.
     - sibling index plus parent kind/type plus at least one sibling hash.
   - For table cells, accept only if exactly one candidate matches one of these evidence sets:
     - `path` plus at least one matching row/cell contextual signal.
     - row index plus column index plus at least one previous/next cell or row hash.
     - both previous and next cell hashes.
     - both previous and next row hashes.
   - If no evidence set leaves exactly one candidate, return `ambiguous` with `reason: "weak-evidence"`.
1. If candidates tie, context is missing, evidence is symmetric, or budget is exhausted, return `ambiguous` or `exhausted`.

Safety invariants:

- Same path alone never resolves a duplicate.
- Same row/column alone never resolves a duplicate table cell.
- Sibling index alone never resolves a duplicate.
- Context never resolves absent content in this landing.
- Ties always fail closed.
- Budget exhaustion always returns `exhausted`, never the best candidate seen so far.

## Text Anchor Relationship

Text anchors and node anchors intentionally differ in policy placement.

Text-anchor primitives return candidates because comment threads, presence, and future span consumers have domain-specific quote/scoring rules.

Node-anchor ambiguity has one shared document-level safety rule: resolving the wrong structural node corrupts selection repair and change retargeting. Therefore `query/node-anchors.ts` should expose both candidate discovery and a conservative resolver, so consumers can inspect candidates when needed without reimplementing the default safety policy.

## Diff And Change Targets

`diff/` should remain a bounded detector for highlightable additions/modifications. This landing should not introduce a public edit script, deletes, moves, or a `DocumentNodeCorrespondence` graph.

`DocumentChangeTarget` should carry node-anchor evidence now because `diff/` is uncommitted feature work and the target already represents anchor-shaped evidence.

```ts
export type DocumentChangeTarget =
  | {
      readonly anchor: DocumentBlockAnchor;
      readonly node: {
        readonly blockId: string;
        readonly path: string;
      };
      readonly kind: "block";
    }
  | {
      readonly anchor: DocumentTableCellAnchor;
      readonly node: {
        readonly cellId: string;
        readonly path: string;
      };
      readonly kind: "table-cell";
    };
```

Invariants:

- `target.anchor` is historical correspondence evidence captured in the snapshot where the target was created.
- `target.node.path` and `target.node.blockId` are snapshot runtime lookup/render projections.
- Retargeting must rebuild both `anchor` and `node` from the matched node/path.
- Correspondence decisions must use `anchor`, not `node`.

`retargetDocumentChanges` should call `resolveDocumentNodeAnchors` in batch. It should preserve fail-closed behavior: unresolved, ambiguous, absent, or exhausted targets are dropped.

`findDocumentChanges` may use node anchors where doing so removes duplicate correspondence logic, but it should not be refactored into a general correspondence model in this pass.

## Component Sync

Component sync may still use same runtime region/block ID as a pre-anchor fast path inside the current editor state. After that, cross-snapshot semantic fallback should go through `DocumentNodeAnchor` resolution.

The generic same-path fallback should be removed for non-empty regions once node anchors are available. The existing transient empty-paragraph path repair can remain as a documented component/editor workaround because empty text has no stable content anchor.

Component sync must not treat unresolved node anchors as permission to guess by path.

## Performance Model

The common path must remain close to the current fingerprint matcher:

- Batched resolution scans the document once for all anchors.
- Unique exact-content matches should not allocate rich candidate context.
- Context is evaluated only for duplicate content buckets in `contextual-content` mode.
- Candidate context records are temporary and bucket-local.
- Anchor construction should not compute parent subtree hashes.
- Anchor construction should compute only own content hash, path hint, cheap immediate sibling hashes, and table row-neighbor hashes where already locally available.
- Resolution cost must count node visits, content-hash estimates, and contextual hash checks against `maxVisitedNodes`.
- Diff retargeting must not do one full traversal per active change.

If diff already has a `DiffContext` budget, anchor creation/resolution inside diff should either share that budget or fail closed when its own budget is exhausted. It must not silently add unbounded work after diff has accepted a bounded window.

## Implementation Steps

1. Replace `src/document/query/fingerprints.ts` with `src/document/query/node-anchors.ts`.
   - Implement anchor creation from `(document, path)`.
   - Implement candidate discovery.
   - Implement batched resolution as the primary API.
   - Keep the single-anchor resolver as a wrapper.
   - Remove fingerprint exports and tests.

2. Update document exports and subsystem docs.
   - Export node-anchor types/functions from `query/index.ts` and `document/index.ts`.
   - Update `src/document/AGENTS.md` to describe node anchors as whole-node evidence, not identity.
   - Update `src/document/diff/AGENTS.md` to say diff consumes node anchors for retargeting but is not a complete edit-script engine.

3. Update `diff/`.
   - Store `anchor` on `DocumentChangeTarget`.
   - Move target path/block id into `current`.
   - Remove raw `contentHash` from target shape.
   - Retarget with `resolveDocumentNodeAnchors`.
   - Keep added/modified public change vocabulary.

4. Update component sync.
   - Replace fingerprint terminology with node-anchor terminology.
   - Use same ID as a local fast path, then node-anchor resolution.
   - Remove generic non-empty same-path fallback after unresolved anchors.
   - Keep explicit empty-paragraph repair if still needed.

5. Update tests.
   - Replace `test/document/fingerprints.test.ts` with `test/document/node-anchors.test.ts`.
   - Update `test/document/changes.test.ts` for anchor-carrying targets and retarget behavior.
   - Update component sync tests for the removal of unsafe path fallback.

## Required Tests

`test/document/node-anchors.test.ts`:

- Exact content matches after path shifts.
- Absent exact content returns `absent`; it does not recover by path/context.
- Duplicate exact content resolves with deterministic path plus sibling/parent context.
- Duplicate exact content remains ambiguous when context is symmetric.
- Same path alone does not resolve duplicates.
- Budget exhaustion returns `exhausted`.
- Batch resolution scans under one shared budget.
- Anchors created from a parsed snapshot resolve after full markdown reparse, not only through object identity.

Table-cell cases:

- Duplicate cell content in the same row disambiguates only with column/cell context.
- Duplicate cell content in the same column disambiguates only with row context.
- Inserted row shifts a target and row/cell context still resolves.
- Inserted column shifts a target and cell context still resolves.
- Identical rows remain ambiguous.
- Identical columns remain ambiguous.

`test/document/changes.test.ts`:

- Retarget exact unique block changes after path shifts.
- Retarget duplicate content only when node-anchor evidence is decisive.
- Drop duplicate content when evidence ties.
- Do not retarget when content is absent but same path exists.
- Retarget table-cell changes through row/column shifts only when evidence is decisive.

Component sync tests:

- Selection repairs through node-anchor match after markdown reparse/path shift.
- Selection does not repair when only same path remains for non-empty content.
- Active changes drop when node-anchor resolution is ambiguous or exhausted.
- Empty paragraph repair remains covered if retained.

Performance validation:

- Many active changes are resolved through one batched traversal.
- Large document with no matching anchors fails within budget.
- Repeated duplicate paragraphs only compute context for the duplicate bucket.
- Large table with duplicate cells remains bounded.
- Small edit inside a huge container does not force hashing the whole parent subtree.

## Validation Commands

```sh
bun test test/document/node-anchors.test.ts test/document/changes.test.ts
bun test test/component/sync/external-reconciliation.test.ts test/component/sync/external-changes.test.ts
bun run typecheck
```

Add a focused benchmark or microfixture for batched anchor resolution before implementation is considered done. Do not rely on a broad benchmark suite to catch anchor-resolution regressions.

## Follow-Up Debt

- A future `correspondDocumentNodes(previous, next, options)` API can use node-anchor candidates/resolution as one evidence source for true structural diffing.
- Content-absent modified-node correspondence belongs in that future many-node correspondence API, not in the first node-anchor resolver.
- `findDocumentChanges` may eventually return a status that distinguishes no changes from broad/ambiguous/exhausted.
- A future structural diff API may expose deletes, moves, and reorders if the product needs them.
