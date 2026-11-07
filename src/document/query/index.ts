// Public surface of the query/ folder: traversal, projection, the anchor
// algebra, and document comparison. Queries do not mutate their inputs;
// comparison may return a derived Document that reinserts deleted content.

// Kind defaults, kind guards, and raw substring search stay private to
// `src/document`; consumers compose the capture and candidate primitives.
export {
  anchorKindForBlockType,
  captureTextAnchor,
  clamp,
  collectTextAnchorCandidates,
  enumerateTextAnchorRanges,
  listAnchorContainers,
  type AnchorContainer,
  type AnchorMatch,
  type TextAnchor,
  type TextAnchorCapture,
} from "./anchors/text";
export * from "./anchors/node";
export * from "./changes";
export * from "./paths";
export * from "./text";
export * from "./visit";
