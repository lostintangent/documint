// Root construction and positioning: turns one top-level document `Block` into
// an `IndexedRoot` slice, then places those slices in block-array and
// region-array coordinate space.

import {
  childBlockPath,
  childContainerPath,
  rootBlockPath,
  sourcePath,
  tableCellPath,
  tableRowPath,
  type Block,
  type Inline,
  type TableCell,
} from "@/document";
import { flattenInlineNodes, indexedInlineText } from "./inlines";
import type {
  IndexedBlock,
  BlockKind,
  IndexedInline,
  IndexedListItem,
  EditableRegionContent,
  EditableRegion,
  IndexedRoot,
} from "./types";

// How a block contributes to the editor's region/coordinate stream. Five
// kinds cover every existing block type and any future one:
//
//   - `container`: recurse into the block's children (blockquote, list, listItem)
//   - `inline-text`: emit one region with flattened inlines (heading, paragraph)
//   - `source-text`: emit one source region holding raw text (code, raw)
//   - `cells`: emit one inline-bearing region per table cell (table)
//   - `inert`: no region (divider, directive)
//
// A new block type is one entry in `BLOCK_CONTRIBUTIONS` below. The visitor
// dispatches on contribution kind, so no per-type branching escapes the table.
// The discriminator literals are constrained by `BlockKind` (see types.ts) so
// contribution kind and `IndexedBlock.kind` stay in lockstep.
type BlockContribution =
  | { kind: "container"; children: readonly Block[] }
  | { kind: "inline-text"; inlines: readonly Inline[] }
  | { kind: "source-text"; source: string }
  | { kind: "cells"; cells: readonly { rowIndex: number; cellIndex: number; cell: TableCell }[] }
  | { kind: "inert" };

// Compile-time guard: every `BlockContribution` discriminator must be a
// `BlockKind`, and every `BlockKind` must appear in `BlockContribution`.
// `kind: contribution.kind` in `visitBlock` enforces the first direction;
// this satisfies-pair enforces the second.
type _BlockKindBidirectional = {
  forward: BlockContribution["kind"] extends BlockKind ? true : never;
  reverse: BlockKind extends BlockContribution["kind"] ? true : never;
};
const _blockKindCheck = { forward: true, reverse: true } satisfies _BlockKindBidirectional;
void _blockKindCheck;

const BLOCK_CONTRIBUTIONS: {
  [K in Block["type"]]: (block: Extract<Block, { type: K }>) => BlockContribution;
} = {
  blockquote: (b) => ({ kind: "container", children: b.children }),
  code: (b) => ({ kind: "source-text", source: b.source }),
  directive: () => ({ kind: "inert" }),
  // Inert leaf block: contributes no region. Inertness is structural — a
  // leaf block (not a container) with no regions. Layout reserves a fixed-
  // height geometry slot; renderer paints chrome via `paintInertBlock`.
  // Caret navigation, hit testing, and the universal merge-collapse rule
  // treat inert blocks correctly by virtue of their absence from region-flow.
  divider: () => ({ kind: "inert" }),
  heading: (b) => ({ kind: "inline-text", inlines: b.children }),
  list: (b) => ({ kind: "container", children: b.items }),
  listItem: (b) => ({ kind: "container", children: b.children }),
  paragraph: (b) => ({ kind: "inline-text", inlines: b.children }),
  raw: (b) => ({ kind: "source-text", source: b.source }),
  table: (b) => ({
    kind: "cells",
    cells: b.rows.flatMap((row, rowIndex) =>
      row.cells.map((cell, cellIndex) => ({ cell, cellIndex, rowIndex })),
    ),
  }),
};

type ListContext = {
  depth: number;
  index: number;
  ordered: boolean;
  start: number | null;
};

const EMPTY_URLS: ReadonlySet<string> = new Set();

function resolveBlockContribution(block: Block): BlockContribution {
  // Cast is safe: the table's discriminator and the block's discriminator
  // are the same union; TypeScript just doesn't track the relationship.
  return (BLOCK_CONTRIBUTIONS[block.type] as (b: Block) => BlockContribution)(block);
}

export function createIndexedRoot(rootBlock: Block, rootIndex: number): IndexedRoot {
  const blocks: IndexedBlock[] = [];
  const regions: EditableRegion[] = [];
  // Collected during the inline walk below, alongside the work already
  // happening in region construction.
  const imageUrls = new Set<string>();
  let resourceUrls: Set<string> | null = null;
  const listItems = new Map<string, IndexedListItem>();

  function visitBlock(
    block: Block,
    path: string,
    depth: number,
    parentBlockPath: string | null,
    listContext: ListContext | null = null,
  ) {
    const contribution = resolveBlockContribution(block);
    const blockArrayIndex = blocks.length;
    const regionRangeStart = regions.length;
    const indexedBlock: IndexedBlock = {
      block,
      // Local per-root index here; re-stamped to the global position when
      // the root is positioned in `positionIndexedRoots` / `positionIndexedRoot`.
      blockArrayIndex,
      blockRangeEnd: blockArrayIndex + 1,
      depth,
      kind: contribution.kind,
      parentBlockPath,
      path,
      regionRangeEnd: regionRangeStart,
      regionRangeStart,
      rootIndex,
    };

    blocks.push(indexedBlock);

    appendIndexedListItem(block, path, listContext);

    switch (contribution.kind) {
      case "container":
        for (const [index, child] of contribution.children.entries()) {
          visitBlock(
            child,
            childBlockPath(path, index),
            depth + 1,
            path,
            resolveChildListContext(block, index, listContext),
          );
        }
        break;
      case "inline-text":
        appendInlineRegion(
          block,
          childContainerPath(path),
          path,
          path,
          flattenInlineNodes(contribution.inlines),
        );
        break;
      case "source-text":
        appendSourceRegion(block, sourcePath(path), path, contribution.source);
        break;
      case "cells":
        for (const { cell, cellIndex, rowIndex } of contribution.cells) {
          const rowPath = tableRowPath(path, rowIndex);
          const cellPath = tableCellPath(rowPath, cellIndex);
          appendInlineRegion(
            block,
            cellPath,
            path,
            cellPath,
            flattenInlineNodes(cell.children),
            { cellIndex, rowIndex },
          );
        }
        break;
      case "inert":
        break;
    }

    indexedBlock.blockRangeEnd = blocks.length;
    indexedBlock.regionRangeEnd = regions.length;
  }

  function appendInlineRegion(
    block: Block,
    path: string,
    blockPath: string,
    containerPath: string,
    inlines: IndexedInline[],
    tableCellPosition: { cellIndex: number; rowIndex: number } | null = null,
  ) {
    const text = inlines.map(indexedInlineText).join("");
    for (const inline of inlines) {
      if (inline.node.type === "image") imageUrls.add(inline.node.url);
      if (inline.node.type === "resource") {
        resourceUrls ??= new Set();
        resourceUrls.add(inline.node.url);
      }
    }
    pushRegion(
      block,
      path,
      blockPath,
      containerPath,
      { kind: "inlines", inlines },
      text,
      tableCellPosition,
    );
  }

  function appendSourceRegion(block: Block, path: string, blockPath: string, source: string) {
    pushRegion(block, path, blockPath, blockPath, { kind: "source" }, source, null);
  }

  function pushRegion(
    block: Block,
    path: string,
    blockPath: string,
    containerPath: string,
    content: EditableRegionContent,
    text: string,
    tableCellPosition: { cellIndex: number; rowIndex: number } | null,
  ) {
    regions.push({
      block,
      blockPath,
      containerPath,
      content,
      // Local per-root region index here; re-stamped to the global position when
      // the root is positioned in `positionIndexedRoots` / `positionIndexedRoot`.
      regionArrayIndex: regions.length,
      path,
      rootIndex,
      tableCellPosition,
      text,
    });
  }

  function appendIndexedListItem(block: Block, path: string, context: ListContext | null) {
    if (block.type !== "listItem") {
      return;
    }

    if (typeof block.checked === "boolean") {
      listItems.set(path, {
        checked: block.checked,
        depth: context?.depth ?? 0,
        kind: "task",
      });
      return;
    }

    if (context?.ordered) {
      listItems.set(path, {
        depth: context.depth,
        kind: "ordered",
        ordinal: (context.start ?? 1) + context.index,
      });
      return;
    }

    listItems.set(path, {
      depth: context?.depth ?? 0,
      kind: "unordered",
    });
  }

  function resolveChildListContext(
    block: Block,
    childIndex: number,
    inherited: ListContext | null,
  ): ListContext | null {
    if (block.type === "list") {
      return {
        depth: inherited ? inherited.depth + 1 : 0,
        index: childIndex,
        ordered: block.ordered,
        start: block.start,
      };
    }

    return inherited;
  }

  visitBlock(rootBlock, rootBlockPath(rootIndex), 0, null);

  return {
    blocks,
    imageUrls,
    resourceUrls: resourceUrls ?? EMPTY_URLS,
    listItems,
    regions,
    rootIndex,
  };
}

// Positions a list of roots in block-array and region-array coordinate space.
// Root identity is reused when those coordinates are unchanged. Shifted roots
// receive new root records, while their nested block and region records are
// reused or shifted according to the coordinate spaces they actually carry.
export function positionIndexedRoots(
  roots: IndexedRoot[],
  previousRoots: IndexedRoot[] | null = null,
) {
  const positionedRoots: IndexedRoot[] = [];
  let blockIndex = 0;
  let regionIndex = 0;

  for (const [rootIndex, root] of roots.entries()) {
    const nextBlockStart = blockIndex;
    const nextBlockEnd = nextBlockStart + root.blocks.length;
    const nextRegionStart = regionIndex;
    const nextRegionEnd = nextRegionStart + root.regions.length;
    const previousRoot = previousRoots?.[rootIndex];

    positionedRoots.push(
      canReuseIndexedRoot(
        previousRoot,
        root,
        nextBlockStart,
        nextBlockEnd,
        nextRegionStart,
        nextRegionEnd,
      )
        ? previousRoot
        : positionIndexedRoot(root, nextBlockStart, nextRegionStart),
    );

    blockIndex = nextBlockEnd;
    regionIndex = nextRegionEnd;
  }

  return positionedRoots;
}

function positionIndexedRoot(
  root: IndexedRoot,
  nextBlockStart: number,
  nextRegionStart: number,
): IndexedRoot {
  const rootBlock = root.blocks[0]!;
  const blockIndexDelta = nextBlockStart - rootBlock.blockArrayIndex;
  const regionIndexDelta = nextRegionStart - rootBlock.regionRangeStart;
  const blocks = shiftEditorBlocks(root.blocks, blockIndexDelta, regionIndexDelta);
  const regions = shiftEditorRegions(root.regions, regionIndexDelta);

  if (blocks === root.blocks && regions === root.regions) {
    return root;
  }

  return {
    ...root,
    // A freshly built root starts with local coordinates, so non-zero deltas
    // stamp it into global space. Reused suffix roots only shift the record
    // families whose coordinate spaces moved.
    blocks,
    regions,
  };
}

function canReuseIndexedRoot(
  previousRoot: IndexedRoot | undefined,
  root: IndexedRoot,
  nextBlockStart: number,
  nextBlockEnd: number,
  nextRegionStart: number,
  nextRegionEnd: number,
): previousRoot is IndexedRoot {
  const previousRootBlock = previousRoot?.blocks[0];

  return Boolean(
    previousRoot &&
    previousRootBlock &&
    root === previousRoot &&
    previousRootBlock.blockArrayIndex === nextBlockStart &&
    previousRootBlock.blockRangeEnd === nextBlockEnd &&
    previousRootBlock.regionRangeStart === nextRegionStart &&
    previousRootBlock.regionRangeEnd === nextRegionEnd,
  );
}

function shiftEditorBlocks(
  blocks: IndexedBlock[],
  blockIndexDelta: number,
  regionIndexDelta: number,
) {
  if (blockIndexDelta === 0 && regionIndexDelta === 0) {
    return blocks;
  }

  return blocks.map<IndexedBlock>((block) => ({
    ...block,
    blockArrayIndex: block.blockArrayIndex + blockIndexDelta,
    blockRangeEnd: block.blockRangeEnd + blockIndexDelta,
    regionRangeEnd: block.regionRangeEnd + regionIndexDelta,
    regionRangeStart: block.regionRangeStart + regionIndexDelta,
  }));
}

function shiftEditorRegions(
  regions: EditableRegion[],
  regionIndexDelta: number,
) {
  if (regionIndexDelta === 0) {
    return regions;
  }

  return regions.map<EditableRegion>((region) => ({
    ...region,
    regionArrayIndex: region.regionArrayIndex + regionIndexDelta,
  }));
}
