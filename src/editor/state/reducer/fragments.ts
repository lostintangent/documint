// Structural seam-merge policy for range replacement.
//
// These helpers operate on already-trimmed semantic `Block` trees and compute
// how a structural replacement rejoins the preserved ends with inserted blocks.
//
// This is the seam-merge policy for *range-selection* operations: paste,
// cross-path replace, and cross-path delete. Caret-driven boundary delete
// lives in `actions/deletion/boundary-collapse.ts` and uses a different shape
// — it knows the surviving block's identity and merges into
// the deepest text-like path in flow rather than peeling shallow container
// pairs. Both paths share the index-owned in-flow neighbor primitives, so any
// future topology change propagates everywhere it should.

import {
  defragmentTextInlines,
  getBlockChildren,
  rebuildTextBlock,
  replaceBlockChildren,
  type Block,
} from "@/document";
import { editorInlineTextLength } from "../../text/inline-offsets";

type TextLikeBlock = Extract<Block, { type: "heading" | "paragraph" }>;
type CaretTarget = { childIndices: number[]; offset: number | "end" };

type MergeResult = {
  blocks: Block[];
  caretLocalIndex: number;
  caretChildIndices: number[];
  caretOffset: number | "end";
  startPathInsertedText: string;
  startPathPreservedAtRoot0: boolean;
  suffixLeavesStartPath: boolean;
};

// Joins a trimmed prefix root and a trimmed suffix root with a fragment of
// replacement blocks between them. Three collapse strategies apply at the
// boundaries between blocks:
//
//   - Front absorb: fragment[0] is a paragraph and prefix is text-like
//     (paragraph/heading). The paragraph's inlines append into prefix,
//     preserving prefix's type. This is the "fluent text inserts into the
//     destination block" behavior.
//   - Back absorb: fragment[-1] is a paragraph and suffix is text-like.
//     Mirror of front absorb; suffix's type is preserved.
//   - Bridge: when no fragment blocks remain between prefix and suffix
//     (either fragment was empty, or its only block was absorbed at the
//     front seam), prefix and suffix collapse directly. Two text-likes
//     concatenate into prefix's type; same-kind containers peel into one.
//     Matches the long-standing cross-path delete-merge semantics.
//   - Container peel: a same-kind container (list/blockquote/listItem) at
//     either fragment end merges its children into the neighbor's
//     children, so adjacent lists or quotes flow into one.
//
// Headings and other structural blocks deliberately do NOT participate in
// seam absorption — pasting `# Foo` mid-paragraph splits it cleanly.
export function mergeTrimmedBlocks(
  prefix: Block | null,
  fragment: Block[],
  suffix: Block | null,
): MergeResult {
  const blocks: Block[] = [];
  let caretLocalIndex = 0;
  let caret: CaretTarget = { childIndices: [], offset: 0 };
  let startPathInsertedText = "";
  // The start path resolves to result.blocks[0] after the splice.
  // When that block doesn't carry the original path's content (e.g. a
  // multi-block paste with no prefix), optimistic comment repair has no
  // reliable offset math; flip this off so the full resolver takes over.
  let startPathPreservedAtRoot0 = prefix !== null;
  // Whether the suffix ends up in a later block or container child instead of
  // right after the inserted text in the start path, where offset repair
  // can't track it.
  let suffixLeavesStartPath = false;

  if (prefix) {
    blocks.push(prefix);
    caret = caretAtBlockEnd(prefix);
  }

  let absorbedFromFront = 0;

  if (prefix && fragment.length > 0) {
    const head = fragment[0]!;

    if (isTextLikeBlock(prefix) && head.type === "paragraph") {
      const merged = concatTextLikeChildren(prefix, prefix.children, head.children);
      blocks[blocks.length - 1] = merged;
      caret = { childIndices: [], offset: editorTextLength(merged) };
      absorbedFromFront = 1;
      startPathInsertedText = head.plainText;
    } else if (canPeelContainers(prefix, head)) {
      const merged = peelContainers(prefix, head);
      blocks[blocks.length - 1] = merged;
      caret = caretAtLastChildEnd(merged);
      absorbedFromFront = 1;
    }
  }

  for (let index = absorbedFromFront; index < fragment.length; index += 1) {
    const block = fragment[index]!;
    blocks.push(block);
    caretLocalIndex = blocks.length - 1;
    caret = caretAtBlockEnd(block);
  }

  if (suffix) {
    suffixLeavesStartPath = true;
    const tailIndex = blocks.length - 1;
    const tail = blocks[tailIndex] ?? null;
    const isBridge = absorbedFromFront >= fragment.length && prefix !== null;
    let merged: Block | null = null;

    if (tail) {
      if (!isBridge && tail.type === "paragraph" && isTextLikeBlock(suffix)) {
        merged = concatTextLikeChildren(suffix, tail.children, suffix.children);
        if (prefix === null && fragment.length === 1) {
          startPathPreservedAtRoot0 = true;
          startPathInsertedText = tail.plainText;
          suffixLeavesStartPath = false;
        }
      } else if (isBridge && isTextLikeBlock(tail) && isTextLikeBlock(suffix)) {
        merged = concatTextLikeChildren(tail, tail.children, suffix.children);
        suffixLeavesStartPath = false;
      } else if (canPeelContainers(tail, suffix)) {
        merged = peelContainers(tail, suffix);
        const leftChildren = getBlockChildren(tail)!;
        caret = { childIndices: [leftChildren.length - 1], offset: "end" };
      }
    } else if (prefix === null && fragment.length === 0) {
      startPathPreservedAtRoot0 = true;
      suffixLeavesStartPath = false;
    }

    if (merged) {
      blocks[tailIndex] = merged;
    } else {
      blocks.push(suffix);
    }
  }

  return {
    blocks,
    caretLocalIndex,
    caretChildIndices: caret.childIndices,
    caretOffset: caret.offset,
    startPathInsertedText,
    startPathPreservedAtRoot0,
    suffixLeavesStartPath,
  };
}

function caretAtBlockEnd(block: Block): CaretTarget {
  return getBlockChildren(block)
    ? caretAtLastChildEnd(block)
    : { childIndices: [], offset: editorTextLength(block) };
}

// Carets count editor text, where a reference is one unit, so they can't use
// `plainText`, which spells out alt text and mention labels.
function editorTextLength(block: Block): number {
  return isTextLikeBlock(block)
    ? block.children.reduce((length, child) => length + editorInlineTextLength(child), 0)
    : block.plainText.length;
}

function caretAtLastChildEnd(block: Block): CaretTarget {
  const children = getBlockChildren(block)!;
  return { childIndices: [children.length - 1], offset: "end" };
}

function concatTextLikeChildren(
  typeFrom: TextLikeBlock,
  leftChildren: TextLikeBlock["children"],
  rightChildren: TextLikeBlock["children"],
): Block {
  return rebuildTextBlock(typeFrom, defragmentTextInlines([...leftChildren, ...rightChildren]));
}

function isTextLikeBlock(block: Block | null): block is TextLikeBlock {
  return block !== null && (block.type === "heading" || block.type === "paragraph");
}

function canPeelContainers(left: Block, right: Block): boolean {
  return left.type === right.type && getBlockChildren(left) !== null;
}

function peelContainers(left: Block, right: Block): Block {
  const leftChildren = getBlockChildren(left)!;
  const rightChildren = getBlockChildren(right)!;
  return replaceBlockChildren(left, [...leftChildren, ...rightChildren])!;
}
