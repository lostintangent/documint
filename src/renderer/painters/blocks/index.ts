// Re-exports for the orchestrator. The blocks family splits into two files:
//   - backgrounds.ts — per-line block backgrounds (code fence fill, table cell
//                      chrome dispatch), per-line active-block tint, and the
//                      stage-4 `paintActiveBlockHighlight` dispatcher
//   - rules.ts       — block-level rules: heading underline, blockquote bar,
//                      divider; plus the per-block-aggregate resolvers
//
// The orchestrator imports from this barrel; nothing else outside the blocks
// family should need direct file imports.

export {
  activeLineVerticalBleed,
  paintActiveBlockBackground,
  paintActiveBlockHighlight,
  paintLineContainerBackground,
} from "./backgrounds";
export {
  paintBlockquoteRules,
  paintHeadingRules,
  paintInertBlock,
  resolveVisibleBlockquoteRegions,
  resolveVisibleHeadingRules,
  type VisibleBlockquoteRegion,
  type VisibleHeadingRule,
} from "./rules";
