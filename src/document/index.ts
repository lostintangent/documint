// Public document boundary. The folder is organized into three buckets:
//
//   schema (root) — the data model and its addressing vocabulary.
//                   `types.ts`, `paths.ts`, `containers.ts`.
//   build/        — producing canonical Documents. Per-node builders,
//                   high-level operations, save-time canonicalization.
//                   `normalize.ts` is internal and not re-exported.
//   query/        — reading from existing Documents. Traversal, projection,
//                   anchor algebra.
//   comments/     — anchored-annotation domain.
//
// Each subfolder has its own `index.ts` that is the single source of truth
// for what crosses the bucket boundary; this root index re-exports those
// surfaces. Keep helpers unexported in their own files if they should stay
// internal to the subsystem.

export * from "./build";
export * from "./comments";
export * from "./containers";
export * from "./paths";
export * from "./query";
export * from "./types";
