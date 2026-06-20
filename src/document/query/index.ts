// Public surface of the query/ folder: traversal, projection, and the
// anchor algebra. Everything here reads from an existing Document tree —
// no construction, no canonicalization.

export * from "./anchors/text";
export * from "./anchors/node";
export * from "./inlines";
export * from "./paths";
export * from "./text";
export * from "./visit";
