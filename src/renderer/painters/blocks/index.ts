// Re-exports for the orchestrator. The blocks family splits into two files:
//   - backgrounds.ts — per-line block backgrounds (code fence fill, table cell
//                      chrome dispatch), active-block tint, and active-block
//                      change effects
//   - rules.ts       — block-level rules: heading underline, blockquote bar,
//                      and divider
//
// The orchestrator imports from this barrel; nothing else outside the blocks
// family should need direct file imports.

export {
  paintActiveBlockBackground,
  paintActiveBlockChangedEffect,
  paintDocumentChangeBackground,
  paintLineContainerBackground,
} from "./backgrounds";
export { paintBlockquoteRules, paintHeadingRules, paintInertBlock } from "./rules";
