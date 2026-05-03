// Type-narrowing inspection helpers for `Document` / `Block` / `Inline`
// trees, shared by any subsystem that produces or operates on one.

import type { Block, Document, Inline } from "@/document";

export function expectBlockAt<K extends Block["type"]>(
  document: Document,
  index: number,
  kind: K,
): Extract<Block, { type: K }> {
  const block = document.blocks[index];

  if (!block) {
    throw new Error(
      `Expected a block at index ${index} but the document has ${document.blocks.length}`,
    );
  }

  if (block.type !== kind) {
    throw new Error(`Expected block at index ${index} to be ${kind}, got ${block.type}`);
  }

  return block as Extract<Block, { type: K }>;
}

export function expectInlineAt<K extends Inline["type"]>(
  inlines: readonly Inline[],
  index: number,
  kind: K,
): Extract<Inline, { type: K }> {
  const node = inlines[index];

  if (!node) {
    throw new Error(`Expected an inline at index ${index} but there were only ${inlines.length}`);
  }

  if (node.type !== kind) {
    throw new Error(`Expected inline at index ${index} to be ${kind}, got ${node.type}`);
  }

  return node as Extract<Inline, { type: K }>;
}

export function findInline<K extends Inline["type"]>(
  inlines: readonly Inline[],
  kind: K,
): Extract<Inline, { type: K }> {
  const found = inlines.find((node) => node.type === kind);

  if (!found) {
    throw new Error(`Expected an inline of type ${kind}`);
  }

  return found as Extract<Inline, { type: K }>;
}
