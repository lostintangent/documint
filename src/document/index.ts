// Public document boundary: semantic types plus the small set of shared
// format-agnostic helpers other subsystems are allowed to depend on.

export {
  type Block,
  type BlockquoteBlock,
  type LineBreak,
  type CodeBlock,
  type Document,
  type DocumentInit,
  type HeadingBlock,
  type Image,
  type Code,
  type Inline,
  type Link,
  type ListBlock,
  type ListItemBlock,
  type Mark,
  type ParagraphBlock,
  type TableBlock,
  type TableCell,
  type TableRow,
  type Text,
  type DividerBlock,
  type RawBlock,
  type Raw,
} from "./types";

export {
  buildDocument,
  extractPlainTextFromBlockNodes,
  extractPlainTextFromInlineNodes,
  nodeId,
  spliceCommentThreads,
  spliceDocument,
} from "./document";

export {
  createBlockquoteBlock,
  createLineBreak,
  createCodeBlock,
  createHeadingBlock,
  createHeadingTextBlock,
  createImage,
  createCode,
  createLink,
  createListBlock,
  createListItemBlock,
  createParagraphBlock,
  createParagraphTextBlock,
  createTableBlock,
  createTableCell,
  createTableRow,
  createText,
  createDividerBlock,
  createRawBlock,
  createRaw,
  rebuildCodeBlock,
  rebuildListBlock,
  rebuildListItemBlock,
  rebuildTableBlock,
  rebuildTextBlock,
  rebuildRawBlock,
} from "./build";

export {
  collectImageUrls,
  findBlockById,
} from "./query";

export {
  visitBlockTree,
  visitDocument,
  visitInlineTree,
  type BlockVisitContext,
  type DocumentVisitor,
  type InlineVisitContext,
  type TableCellVisitContext,
  type VisitControl,
} from "./visit";
