import { getBlockChildren } from "../model/containers";
import {
  FNV_OFFSET_BASIS,
  HASH_SEPARATOR_CHAR_CODE,
  finishHash,
  mixByteIntoHash,
  mixStringIntoHash,
} from "../model/fnv";
import type { Block, Inline, TableCell, TableRow } from "../model/types";

declare const documentNodeContentHashBrand: unique symbol;

export type DocumentNodeContentHash = number & {
  readonly [documentNodeContentHashBrand]: "DocumentNodeContentHash";
};

const blockContentHashCache = new WeakMap<Block, DocumentNodeContentHash>();
const inlineContentHashCache = new WeakMap<Inline, DocumentNodeContentHash>();
const tableCellContentHashCache = new WeakMap<TableCell, DocumentNodeContentHash>();
const tableRowContentHashCache = new WeakMap<TableRow, DocumentNodeContentHash>();

export function resolveBlockContentHash(block: Block): DocumentNodeContentHash {
  const cached = blockContentHashCache.get(block);

  if (cached !== undefined) {
    return cached;
  }

  const contentHash = computeDocumentNodeContentHash(block);
  blockContentHashCache.set(block, contentHash);
  return contentHash;
}

export function resolveTableCellContentHash(cell: TableCell): DocumentNodeContentHash {
  const cached = tableCellContentHashCache.get(cell);

  if (cached !== undefined) {
    return cached;
  }

  let hash = createHash("tableCell");
  hash = mixInlineArray(hash, cell.children);
  const contentHash = finishContentHash(hash);
  tableCellContentHashCache.set(cell, contentHash);
  return contentHash;
}

function computeDocumentNodeContentHash(block: Block): DocumentNodeContentHash {
  let hash = createHash(block.type);

  switch (block.type) {
    case "blockquote":
      hash = mixBlockArray(hash, getBlockChildren(block) ?? []);
      break;
    case "code":
      hash = mixNullableString(hash, block.language);
      hash = mixNullableString(hash, block.meta);
      hash = mixString(hash, block.source);
      break;
    case "directive":
      hash = mixString(hash, block.name);
      hash = mixString(hash, block.attributes);
      hash = mixString(hash, block.body);
      break;
    case "divider":
      hash = mixString(hash, "divider");
      break;
    case "heading":
      hash = mixNumber(hash, block.depth);
      hash = mixInlineArray(hash, block.children);
      break;
    case "list":
      hash = mixBoolean(hash, block.ordered);
      hash = mixNullableNumber(hash, block.start);
      hash = mixBoolean(hash, block.compact);
      hash = mixBlockArray(hash, block.items);
      break;
    case "listItem":
      hash = mixNullableBoolean(hash, block.checked);
      hash = mixBoolean(hash, block.compact);
      hash = mixBlockArray(hash, block.children);
      break;
    case "paragraph":
      hash = mixInlineArray(hash, block.children);
      break;
    case "raw":
      hash = mixString(hash, block.originalType);
      hash = mixString(hash, block.source);
      break;
    case "table":
      hash = mixNumber(hash, block.align.length);
      for (const align of block.align) {
        hash = mixNullableString(hash, align);
      }
      hash = mixNumber(hash, block.rows.length);
      for (const row of block.rows) {
        hash = mixNumber(hash, resolveTableRowContentHash(row));
      }
      break;
  }

  return finishContentHash(hash);
}

function resolveInlineContentHash(inline: Inline): DocumentNodeContentHash {
  const cached = inlineContentHashCache.get(inline);

  if (cached !== undefined) {
    return cached;
  }

  let hash = createHash(inline.type);

  switch (inline.type) {
    case "image":
      hash = mixNullableString(hash, inline.alt);
      hash = mixNullableString(hash, inline.title);
      hash = mixString(hash, inline.url);
      hash = mixNullableNumber(hash, inline.width);
      break;
    case "lineBreak":
      hash = mixString(hash, "lineBreak");
      break;
    case "link":
      hash = mixString(hash, inline.url);
      hash = mixNullableString(hash, inline.title);
      hash = mixInlineArray(hash, inline.children);
      break;
    case "mention":
      hash = mixString(hash, inline.userId);
      hash = mixString(hash, inline.name);
      break;
    case "raw":
      hash = mixString(hash, inline.originalType);
      hash = mixString(hash, inline.source);
      break;
    case "resource":
      hash = mixString(hash, inline.protocol);
      hash = mixString(hash, inline.url);
      hash = mixString(hash, inline.label);
      break;
    case "text":
      hash = mixString(hash, inline.text);
      hash = mixNumber(hash, inline.marks.length);
      for (const mark of inline.marks) {
        hash = mixString(hash, mark);
      }
      break;
  }

  const contentHash = finishContentHash(hash);
  inlineContentHashCache.set(inline, contentHash);
  return contentHash;
}

export function resolveTableRowContentHash(row: TableRow): DocumentNodeContentHash {
  const cached = tableRowContentHashCache.get(row);

  if (cached !== undefined) {
    return cached;
  }

  let hash = createHash("tableRow");
  hash = mixNumber(hash, row.cells.length);
  for (const cell of row.cells) {
    hash = mixNumber(hash, resolveTableCellContentHash(cell));
  }
  const contentHash = finishContentHash(hash);
  tableRowContentHashCache.set(row, contentHash);
  return contentHash;
}

export function estimateDocumentNodeContentHashCost(block: Block) {
  if ("plainText" in block && typeof block.plainText === "string") {
    return estimateTextCost(block.plainText);
  }

  if ("source" in block && typeof block.source === "string") {
    return estimateTextCost(block.source);
  }

  if (block.type === "table") {
    return block.rows.reduce((sum, row) => sum + estimateTableRowContentHashCost(row), 1);
  }

  return 1;
}

export function estimateTableRowContentHashCost(row: TableRow) {
  return row.cells.reduce((sum, cell) => sum + estimateTableCellContentHashCost(cell), 1);
}

export function estimateTableCellContentHashCost(cell: TableCell) {
  return estimateTextCost(cell.plainText);
}

function mixBlockArray(hash: number, blocks: readonly Block[]) {
  hash = mixNumber(hash, blocks.length);
  for (const block of blocks) {
    hash = mixNumber(hash, resolveBlockContentHash(block));
  }
  return hash;
}

function mixInlineArray(hash: number, inlines: readonly Inline[]) {
  hash = mixNumber(hash, inlines.length);
  for (const inline of inlines) {
    hash = mixNumber(hash, resolveInlineContentHash(inline));
  }
  return hash;
}

function createHash(type: string) {
  return mixString(FNV_OFFSET_BASIS, type);
}

function finishContentHash(hash: number): DocumentNodeContentHash {
  return finishHash(hash) as DocumentNodeContentHash;
}

function mixString(hash: number, segment: string) {
  hash = mixByteIntoHash(hash, HASH_SEPARATOR_CHAR_CODE);
  hash = mixNumber(hash, segment.length);
  return mixStringIntoHash(hash, segment);
}

function mixNullableString(hash: number, value: string | null) {
  return value === null ? mixString(hash, "<null>") : mixString(hash, value);
}

function mixNumber(hash: number, value: number) {
  hash = mixByteIntoHash(hash, HASH_SEPARATOR_CHAR_CODE);
  hash = mixByteIntoHash(hash, value & 0xff);
  hash = mixByteIntoHash(hash, (value >>> 8) & 0xff);
  hash = mixByteIntoHash(hash, (value >>> 16) & 0xff);
  hash = mixByteIntoHash(hash, (value >>> 24) & 0xff);
  return hash;
}

function mixNullableNumber(hash: number, value: number | null) {
  return value === null ? mixString(hash, "<null>") : mixNumber(hash, value);
}

function mixBoolean(hash: number, value: boolean) {
  return mixByteIntoHash(hash, value ? 1 : 0);
}

function mixNullableBoolean(hash: number, value: boolean | null) {
  return value === null ? mixString(hash, "<null>") : mixBoolean(hash, value);
}

function estimateTextCost(text: string) {
  return Math.max(1, Math.ceil(text.length / 256));
}
