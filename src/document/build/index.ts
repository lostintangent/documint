// Public surface of the build/ folder: everything callers need to construct
// or canonicalize a Document tree. `normalize.ts` is intentionally absent —
// identity hashing and the canonical id/plainText pass are construction-path
// internals owned by `document.ts`'s `createDocument` / `spliceDocument`,
// not something external callers should reach for directly.

export * from "./builders";
export * from "./canonicalize";
export * from "./document";
