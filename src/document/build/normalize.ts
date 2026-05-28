// Canonicalization for a freshly-built block tree: assigns deterministic
// `id`s from tree paths and recurses into every container so the whole tree
// is canonical end to end. The semantic content of a node decides its
// identity; the path decides where two otherwise-identical nodes get
// distinct IDs. Identity is the same across runs and machines for the same
// input.
//
// `createDocument` and `spliceDocument` are the only callers. Builders in
// `./builders` produce un-normalized shapes (with `id: ""`) but otherwise
// already-canonical derived fields (`plainText`, canonical mark order);
// this module owns the path-derived id pass that turns those into
// committed `Document` nodes.
//
// Per-node, normalize does exactly two things: rebuild structural children
// (so each child gets a path-derived id), then spread the result with a
// fresh `id`. `plainText` and inline `marks` carry through from the builder
// — text content doesn't change during normalize, only IDs do — so
// re-deriving them here would be redundant work. The spread also means
// non-structural fields (`language`, `meta`, `depth`, `align`, …) carry
// through automatically: adding a property to a node type doesn't require
// touching normalize.

import { blockContainerSpec } from "../containers";
import { childBlockPath, rootBlockPath, tableCellPath, tableRowPath } from "../paths";
import { extractPlainTextFromInlineNodes } from "../query/text";
import type { Block, Inline, TableRow } from "../types";

export function normalizeRootBlock(block: Block, rootIndex: number): Block {
  return normalizeBlockNode(block, rootBlockPath(rootIndex));
}

function normalizeBlockNode(node: Block, path: string): Block {
  const recursed = recurseBlockChildren(node, path);
  // Trust the builder's `plainText`: every Block reaches normalize via a
  // builder (`createParagraphBlock`, `createBlockquoteBlock`, etc.) that
  // computed `plainText` from the same inline/child text content normalize
  // would walk again. `recurseBlockChildren` only reassigns IDs — text
  // content is preserved — so the cached value is still canonical.
  return {
    ...recursed,
    id: nodeId(recursed, path, recursed.plainText),
  };
}

// Walk the node's structural children (block- or inline-typed) and return the
// node with rebuilt children. Leaves return themselves unchanged. Derived
// fields (`id`, `plainText`) are intentionally left stale here — they're
// assigned a line later by `normalizeBlockNode`.
function recurseBlockChildren(node: Block, path: string): Block {
  const spec = blockContainerSpec(node);

  if (spec) {
    const children = spec
      .read(node)
      .map((child, index) => normalizeBlockNode(child, childBlockPath(path, index)));
    return spec.withChildren(node, children);
  }

  switch (node.type) {
    case "heading":
    case "paragraph":
      return {
        ...node,
        children: node.children.map((child, index) =>
          normalizeInlineNode(child, childBlockPath(path, index)),
        ),
      };
    case "table":
      return {
        ...node,
        rows: node.rows.map((row, rowIndex) =>
          normalizeTableRowNode(row, tableRowPath(path, rowIndex)),
        ),
      };
    default:
      // Leaf blocks (code, directive, divider, raw) have nothing to recurse.
      return node;
  }
}

function normalizeTableRowNode(row: TableRow, path: string): TableRow {
  const cells = row.cells.map((cell, cellIndex) => {
    const cellPath = tableCellPath(path, cellIndex);
    const children = cell.children.map((child, index) =>
      normalizeInlineNode(child, childBlockPath(cellPath, index)),
    );
    const plainText = extractPlainTextFromInlineNodes(children);

    return {
      ...cell,
      children,
      id: tableCellId(cellPath, plainText),
      plainText,
    };
  });

  return {
    ...row,
    cells,
    id: tableRowId(path, cells.length),
  };
}

function normalizeInlineNode(node: Inline, path: string): Inline {
  if (node.type !== "link") {
    // Trust the builder's mark canonicalization: every `Text` node reaches
    // normalize via `createText`, which already routed `marks` through
    // `canonicalizeMarks`. Re-canonicalizing here would allocate a fresh
    // `Set`/array/sort per text node for no change in output.
    return { ...node, id: nodeId(node, path) };
  }

  const children = node.children.map((child, index) =>
    normalizeInlineNode(child, childBlockPath(path, index)),
  );
  const recursed: Inline = { ...node, children };

  return {
    ...recursed,
    id: nodeId(recursed, path, extractPlainTextFromInlineNodes(children)),
  };
}

// --- Identity ---
//
// `nodeId` derives an id for every block and inline node here; non-node
// identities (e.g. comment threads in `comments/threads.ts`) compose their
// own seed and call the exported `structuralId` below. Both routes share
// `hashedId`, an FNV-1a non-cryptographic hash, so identities are
// deterministic across runs and machines for the same input.
//
// `nodeId` composes its semantic seed from `blockSeedFor` / `inlineSeedFor`.
// Add or remove a field that should participate in identity by editing one
// of those two switches — that's the one place to look. `plainText` is
// passed in as a parameter rather than read off `node.plainText` directly
// because the inline-container case (`link`) computes the projection on the
// fly from its just-normalized children and has no `plainText` field of its
// own; block callers pass `recursed.plainText` (the builder's canonical
// value, preserved through recursion).

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const SEED_SEPARATOR_CHAR_CODE = 0x3a; // ':'

// FNV-1a, but consumes `type`, `path`, and `semanticSeed` directly without
// concatenating them into an intermediate payload string. Bit-identical to
// hashing `${type}:${path}:${semanticSeed}` — the same bytes get XOR-mixed
// and multiplied in the same order — but skips one large allocation per
// node, which matters when `semanticSeed` carries a long `plainText`.
function hashedId(type: string, path: string, semanticSeed: string): string {
  let hash = FNV_OFFSET_BASIS;
  hash = mixStringIntoHash(hash, type);
  hash = mixByteIntoHash(hash, SEED_SEPARATOR_CHAR_CODE);
  hash = mixStringIntoHash(hash, path);
  hash = mixByteIntoHash(hash, SEED_SEPARATOR_CHAR_CODE);
  hash = mixStringIntoHash(hash, semanticSeed);

  return `${type}-${(hash >>> 0).toString(36)}`;
}

function mixStringIntoHash(hash: number, segment: string): number {
  for (let index = 0; index < segment.length; index += 1) {
    hash ^= segment.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash;
}

function mixByteIntoHash(hash: number, byte: number): number {
  hash ^= byte;
  return Math.imul(hash, FNV_PRIME);
}

function nodeId(node: Block | Inline, path: string, plainText?: string): string {
  // Block and inline unions both contain `"code"` and `"raw"` discriminators
  // for structurally different node shapes; route through the union-specific
  // seed builder so narrowing stays exact.
  const seed = isBlockNode(node) ? blockSeedFor(node, plainText) : inlineSeedFor(node, plainText);
  return hashedId(node.type, path, seed);
}

function tableCellId(path: string, plainText: string): string {
  return hashedId("tableCell", path, plainText);
}

function tableRowId(path: string, cellCount: number): string {
  return hashedId("tableRow", path, String(cellCount));
}

// Discriminator: blocks all carry `plainText` as a derived field; inlines
// never do. Cheaper and clearer than enumerating block types here.
function isBlockNode(node: Block | Inline): node is Block {
  return "plainText" in node;
}

// Single source of truth for which fields contribute to a block's identity.
// Adding or removing a field that should affect identity is a one-line edit
// here. `plainText` is supplied by the normalizer for container blocks whose
// identity depends on rendered text; leaf blocks ignore it.
function blockSeedFor(node: Block, plainText?: string): string {
  switch (node.type) {
    case "code":
      return `${node.language ?? ""}:${node.source}`;
    case "directive":
      return `${node.name}{${node.attributes}}:${node.body}`;
    case "divider":
      return "divider";
    case "raw":
      return node.source;
    case "blockquote":
    case "listItem":
    case "paragraph":
      return plainText ?? "";
    case "heading":
      return `${node.depth}:${plainText ?? ""}`;
    case "list":
      return `${String(node.ordered)}:${plainText ?? ""}`;
    case "table":
      return plainText ?? "";
  }
}

// Inline counterpart of `blockSeedFor`. `plainText` is supplied for the
// only inline container — `link` — and ignored elsewhere.
function inlineSeedFor(node: Inline, plainText?: string): string {
  switch (node.type) {
    case "lineBreak":
      return "lineBreak";
    case "image":
      return `${node.url}:${node.width ?? ""}:${node.alt ?? ""}`;
    case "mention":
      return `${node.userId}:${node.name}`;
    case "resource":
      return `${node.url}:${node.label}`;
    case "text":
      return `${node.text}:${node.marks.join(",")}`;
    case "raw":
      return node.source;
    case "link":
      return `${node.url}:${plainText ?? ""}`;
  }
}

// Public entry point for non-node identities (comment threads). Exposed so
// consumers outside the construction path can share the FNV plumbing without
// re-implementing it. The seed recipe is the caller's concern — `build/`
// stays out of comment-domain field shapes.
export function structuralId(type: string, path: string, semanticSeed: string): string {
  return hashedId(type, path, semanticSeed);
}
