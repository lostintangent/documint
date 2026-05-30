// Root construction and positioning: turns a document `Block` tree into a
// `IndexedRoot` (the per-root scaffolding the index uses internally), then
// places multiple roots in global char-offset / block-array / region-array
// coordinate space. Reference identity for unchanged roots is preserved
// through `canReuseIndexedRoot`.

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

// How a block contributes to the document's region/coordinate stream. Five
// kinds cover every existing block type and any future one:
//
//   - `container`: recurse into the block's children (blockquote, list, listItem)
//   - `inline-text`: emit one region with flattened inlines (heading, paragraph)
//   - `source-text`: emit one source region holding raw text (code, raw)
//   - `cells`: emit one inline-bearing region per table cell (table)
//   - `inert`: no region (divider, directive)
//
// Adding a new block type is one indexedBlock in `BLOCK_CONTRIBUTIONS` below. The
// visitor dispatches on contribution kind, so no per-type branching elsewhere
// in this layer. The discriminator literals are constrained by `BlockKind`
// (see types.ts) so contribution → IndexedBlock.kind stays in lockstep.
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
  // Collected during the inline walk below, alongside the work that's
  // already happening — no extra traversal.
  const imageUrls = new Set<string>();
  let resourceUrls: Set<string> | null = null;
  const listItems = new Map<string, IndexedListItem>();
  let position = 0;

  function appendInlineRegion(
    block: Block,
    path: string,
    containerPath: string,
    inlines: IndexedInline[],
    semanticRegionId: string,
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
      containerPath,
      { kind: "inlines", inlines },
      semanticRegionId,
      text,
      tableCellPosition,
    );
  }

  function appendSourceRegion(block: Block, path: string, blockPath: string, source: string) {
    pushRegion(block, path, blockPath, { kind: "source" }, block.id, source, null);
  }

  function pushRegion(
    block: Block,
    path: string,
    containerPath: string,
    content: EditableRegionContent,
    semanticRegionId: string,
    text: string,
    tableCellPosition: { cellIndex: number; rowIndex: number } | null,
  ) {
    if (regions.length > 0) {
      position += 1;
    }
    const start = position;
    const end = start + text.length;
    position = end;
    regions.push({
      block,
      containerPath,
      content,
      // Local per-root order here; re-stamped to the global position when
      // the root is positioned in `positionIndexedRoots` / `positionIndexedRoot`.
      documentOrder: regions.length,
      end,
      id: `${block.id}:${path}`,
      path,
      rootIndex,
      semanticRegionId,
      start,
      tableCellPosition,
      text,
    });
  }

  function visitBlock(
    block: Block,
    path: string,
    depth: number,
    parentBlockId: string | null,
    listContext: ListContext | null = null,
  ) {
    const contribution = resolveBlockContribution(block);
    const indexedBlock: IndexedBlock = {
      block,
      // Local per-root index here; re-stamped to the global position when
      // the root is positioned in `positionIndexedRoots` / `positionIndexedRoot`.
      blockArrayIndex: blocks.length,
      depth,
      end: position,
      kind: contribution.kind,
      parentBlockId,
      path,
      regionIds: [],
      rootIndex,
      start: position,
    };

    blocks.push(indexedBlock);

    appendIndexedListItem(block, listContext);

    switch (contribution.kind) {
      case "container":
        for (const [index, child] of contribution.children.entries()) {
          visitBlock(
            child,
            childBlockPath(path, index),
            depth + 1,
            block.id,
            resolveChildListContext(block, index, listContext),
          );
        }
        break;
      case "inline-text":
        appendInlineRegion(
          block,
          childContainerPath(path),
          path,
          flattenInlineNodes(contribution.inlines),
          block.id,
        );
        indexedBlock.regionIds.push(regions.at(-1)!.id);
        break;
      case "source-text":
        appendSourceRegion(block, sourcePath(path), path, contribution.source);
        indexedBlock.regionIds.push(regions.at(-1)!.id);
        break;
      case "cells":
        for (const { cell, cellIndex, rowIndex } of contribution.cells) {
          const rowPath = tableRowPath(path, rowIndex);
          const cellPath = tableCellPath(rowPath, cellIndex);
          appendInlineRegion(
            block,
            cellPath,
            cellPath,
            flattenInlineNodes(cell.children),
            cell.id,
            { cellIndex, rowIndex },
          );
          indexedBlock.regionIds.push(regions.at(-1)!.id);
        }
        break;
      case "inert":
        break;
    }

    indexedBlock.end = position;
  }

  function appendIndexedListItem(block: Block, context: ListContext | null) {
    if (block.type !== "listItem") {
      return;
    }

    if (typeof block.checked === "boolean") {
      listItems.set(block.id, {
        checked: block.checked,
        depth: context?.depth ?? 0,
        kind: "task",
      });
      return;
    }

    if (context?.ordered) {
      listItems.set(block.id, {
        depth: context.depth,
        kind: "ordered",
        ordinal: (context.start ?? 1) + context.index,
      });
      return;
    }

    listItems.set(block.id, {
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
    blockRange: {
      end: blocks.length,
      start: 0,
    },
    blocks,
    end: position,
    imageUrls,
    resourceUrls: resourceUrls ?? EMPTY_URLS,
    listItems,
    regionRange:
      regions.length > 0
        ? {
            end: regions.length,
            start: 0,
          }
        : undefined,
    regions,
    rootIndex,
    start: 0,
  };
}

export function rebuildIndexedRoot(root: IndexedRoot, rootBlock: Block): IndexedRoot {
  return createIndexedRoot(rootBlock, root.rootIndex);
}

// Positions a list of unpositioned roots in global char-offset, block-array,
// and region-array coordinate space. Reuses the previous root reference when
// nothing changed (so `documentIndex.roots[i]` keeps `===` identity); shifts
// to new objects when char or array offsets moved.
//
// Note: identity reuse is per-root. When a root's `start` or `blockRange`
// shifts (e.g., insert-at-front), every indexed block and region inside it
// is re-stamped with new global indices and therefore loses reference
// identity. Layout caches keyed by index-record references should expect to
// refill on edits that shift root positions.
export function positionIndexedRoots(
  roots: IndexedRoot[],
  previousRoots: IndexedRoot[] | null = null,
) {
  const positionedRoots: IndexedRoot[] = [];
  let blockIndex = 0;
  let regionIndex = 0;
  let position = 0;
  let hasVisibleRootBefore = false;

  for (const [rootIndex, root] of roots.entries()) {
    if (root.regions.length > 0 && hasVisibleRootBefore) {
      position += 1;
    }

    const nextRoot = {
      ...root,
      blockRange: {
        end: blockIndex + root.blocks.length,
        start: blockIndex,
      },
      end: position + (root.end - root.start),
      regionRange:
        root.regions.length > 0
          ? {
              end: regionIndex + root.regions.length,
              start: regionIndex,
            }
          : undefined,
      start: position,
    } satisfies IndexedRoot;
    const previousRoot = previousRoots?.[rootIndex];

    positionedRoots.push(
      canReuseIndexedRoot(previousRoot, root, nextRoot)
        ? previousRoot
        : positionIndexedRoot(root, nextRoot),
    );

    blockIndex = nextRoot.blockRange.end;
    regionIndex = nextRoot.regionRange?.end ?? regionIndex;

    if (root.regions.length > 0) {
      position = nextRoot.end;
      hasVisibleRootBefore = true;
    }
  }

  return positionedRoots;
}

function positionIndexedRoot(root: IndexedRoot, nextRoot: IndexedRoot): IndexedRoot {
  const delta = nextRoot.start - root.start;
  const blockArrayStart = nextRoot.blockRange.start;
  const regionArrayStart = nextRoot.regionRange?.start ?? 0;

  return {
    ...nextRoot,
    // Always re-stamp blocks/regions so `blockArrayIndex` and
    // `documentOrder` reflect the global position. We can't skip the clone
    // on `delta === 0` — a freshly-built root might happen to start at the
    // same char offset but still need its block/region indices stamped
    // from local to global, and a sibling root losing a region can shift
    // this root's `regionRange.start` while leaving char position unchanged.
    blocks: shiftEditorBlocks(root.blocks, delta, blockArrayStart),
    regions: shiftEditorRegions(root.regions, delta, regionArrayStart),
  };
}

function canReuseIndexedRoot(
  previousRoot: IndexedRoot | undefined,
  root: IndexedRoot,
  nextRoot: IndexedRoot,
): previousRoot is IndexedRoot {
  return Boolean(
    previousRoot &&
    root === previousRoot &&
    previousRoot.start === nextRoot.start &&
    previousRoot.end === nextRoot.end &&
    previousRoot.blockRange.start === nextRoot.blockRange.start &&
    previousRoot.blockRange.end === nextRoot.blockRange.end &&
    previousRoot.regionRange?.start === nextRoot.regionRange?.start &&
    previousRoot.regionRange?.end === nextRoot.regionRange?.end,
  );
}

function shiftEditorBlocks(blocks: IndexedBlock[], delta: number, blockArrayStart: number) {
  return blocks.map<IndexedBlock>((block, index) => ({
    ...block,
    blockArrayIndex: blockArrayStart + index,
    end: block.end + delta,
    start: block.start + delta,
  }));
}

function shiftEditorRegions(regions: EditableRegion[], delta: number, regionArrayStart: number) {
  return regions.map<EditableRegion>((region, index) => ({
    ...region,
    documentOrder: regionArrayStart + index,
    end: region.end + delta,
    start: region.start + delta,
  }));
}
