// Shared geometry policy for fenced code blocks.

import type { Block } from "@/document";

export const CODE_BLOCK_CONTENT_PADDING_X = 12;
export const CODE_BLOCK_BACKGROUND_PADDING_Y = 6;

// Space a block reserves above and below its text. Path bounds cover only the
// text, so exact layout, virtual estimates, and slice seeds all add this around
// them to agree on where the block starts and ends.
export function resolveBlockPaddingY(block: Block) {
  return block.type === "code" ? CODE_BLOCK_BACKGROUND_PADDING_Y : 0;
}
