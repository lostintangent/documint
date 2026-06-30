// Public surface of the query/ folder: traversal, projection, the anchor
// algebra, and bounded change detection. Everything here reads from an existing
// Document tree — no construction, no canonicalization.

export * from "./anchors/text";
export * from "./anchors/node";
export * from "./changes";
export * from "./paths";
export * from "./text";
export * from "./visit";
