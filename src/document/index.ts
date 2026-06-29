// Public document boundary. The folder is organized into four buckets:
//
//   model/       — the closed semantic schema, addressing vocabulary,
//                  container/resource policy, and inline mark canonicalization.
//   build/        — producing canonical Documents. Per-node builders,
//                   high-level operations, save-time canonicalization.
//                   Non-node structural IDs stay internal.
//   query/        — reading from existing Documents. Traversal, projection,
//                   anchor algebra.
//   diff/         — bounded semantic change detection and anchor matching
//                   across immutable Document snapshots.
//   comments/     — anchored-annotation domain.
//
// Each subfolder has its own `index.ts` that is the single source of truth
// for what crosses the bucket boundary; this root index re-exports those
// surfaces. Keep helpers unexported in their own files if they should stay
// internal to the subsystem.

export * from "./build";
export * from "./comments";
export * from "./diff";
export * from "./model";
export * from "./query";
