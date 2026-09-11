// Public surface of the query/ folder: traversal, projection, the anchor
// algebra, and document comparison. Queries do not mutate their inputs;
// comparison may return a derived Document that reinserts deleted content.

export * from "./anchors/text";
export * from "./anchors/node";
export * from "./changes";
export * from "./paths";
export * from "./text";
export * from "./visit";
