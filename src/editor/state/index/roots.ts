// Root construction and positioning: turns a document `Block` tree into a
// `RootEntry` (the per-root scaffolding the index uses internally), then
// places multiple roots in global char-offset / block-array / region-array
// coordinate space. Reference identity for unchanged roots is preserved
// through `canReuseRootEntry`.

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
import { flattenInlineNodes } from "./inlines";
import type {
  BlockEntry,
  BlockKind,
  InlineEntry,
  ListItemMarker,
  RegionContent,
  RegionEntry,
  RootEntry,
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
// Adding a new block type is one entry in `BLOCK_CONTRIBUTIONS` below. The
// visitor dispatches on contribution kind, so no per-type branching elsewhere
// in this layer. The discriminator literals are constrained by `BlockKind`
// (see types.ts) so contribution → BlockEntry.kind stays in lockstep.
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

type ListMarkerContext = {
  depth: number;
  index: number;
  ordered: boolean;
  start: number | null;
};

function resolveBlockContribution(block: Block): BlockContribution {
  // Cast is safe: the table's discriminator and the block's discriminator
  // are the same union; TypeScript just doesn't track the relationship.
  return (BLOCK_CONTRIBUTIONS[block.type] as (b: Block) => BlockContribution)(block);
}

export function createRootEntry(rootBlock: Block, rootIndex: number): RootEntry {
  const blocks: BlockEntry[] = [];
  const regions: RegionEntry[] = [];
  // Collected during the inline walk below, alongside the work that's
  // already happening — no extra traversal.
  const imageUrls = new Set<string>();
  const listItemMarkers = new Map<string, ListItemMarker>();
  let position = 0;

  function appendInlineRegion(
    block: Block,
    path: string,
    containerPath: string,
    inlines: InlineEntry[],
    semanticRegionId: string,
    tableCellPosition: { cellIndex: number; rowIndex: number } | null = null,
  ) {
    const text = inlines.map((inline) => inline.text).join("");
    for (const inline of inlines) {
      if (inline.node.type === "image") imageUrls.add(inline.node.url);
    }
    pushRegion(
      block,
      path,
      containerPath,
      { kind: "inline-text", inlines },
      semanticRegionId,
      text,
      tableCellPosition,
    );
  }

  function appendSourceRegion(block: Block, path: string, blockPath: string, source: string) {
    pushRegion(block, path, blockPath, { kind: "source-text" }, block.id, source, null);
  }

  function pushRegion(
    block: Block,
    path: string,
    containerPath: string,
    content: RegionContent,
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
      // the root is positioned in `positionRootEntries` / `positionRootEntry`.
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
    listMarkerContext: ListMarkerContext | null = null,
  ) {
    const contribution = resolveBlockContribution(block);
    const blockEntry: BlockEntry = {
      block,
      // Local per-root index here; re-stamped to the global position when
      // the root is positioned in `positionRootEntries` / `positionRootEntry`.
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

    blocks.push(blockEntry);

    appendListItemMarker(block, listMarkerContext);

    switch (contribution.kind) {
      case "container":
        for (const [index, child] of contribution.children.entries()) {
          visitBlock(
            child,
            childBlockPath(path, index),
            depth + 1,
            block.id,
            resolveChildListMarkerContext(block, index, listMarkerContext),
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
        blockEntry.regionIds.push(regions.at(-1)!.id);
        break;
      case "source-text":
        appendSourceRegion(block, sourcePath(path), path, contribution.source);
        blockEntry.regionIds.push(regions.at(-1)!.id);
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
          blockEntry.regionIds.push(regions.at(-1)!.id);
        }
        break;
      case "inert":
        break;
    }

    blockEntry.end = position;
  }

  function appendListItemMarker(block: Block, context: ListMarkerContext | null) {
    if (block.type !== "listItem") {
      return;
    }

    if (typeof block.checked === "boolean") {
      listItemMarkers.set(block.id, {
        checked: block.checked,
        depth: context?.depth ?? 0,
        kind: "task",
      });
      return;
    }

    if (context?.ordered) {
      listItemMarkers.set(block.id, {
        depth: context.depth,
        kind: "ordered",
        ordinal: (context.start ?? 1) + context.index,
      });
      return;
    }

    listItemMarkers.set(block.id, {
      depth: context?.depth ?? 0,
      kind: "unordered",
    });
  }

  function resolveChildListMarkerContext(
    block: Block,
    childIndex: number,
    inherited: ListMarkerContext | null,
  ): ListMarkerContext | null {
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
    listItemMarkers,
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

export function rebuildRootEntry(root: RootEntry, rootBlock: Block): RootEntry {
  return createRootEntry(rootBlock, root.rootIndex);
}

// Positions a list of unpositioned roots in global char-offset, block-array,
// and region-array coordinate space. Reuses the previous root reference when
// nothing changed (so `documentIndex.roots[i]` keeps `===` identity); shifts
// to new objects when char or array offsets moved.
//
// Note: identity reuse is per-root. When a root's `start` or `blockRange`
// shifts (e.g., insert-at-front), every block/region entry inside it is
// re-stamped with new global indices and therefore loses reference identity.
// Layout caches keyed by entry references should expect to refill on edits
// that shift root positions.
export function positionRootEntries(
  roots: RootEntry[],
  previousRoots: RootEntry[] | null = null,
) {
  const positionedRoots: RootEntry[] = [];
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
    } satisfies RootEntry;
    const previousRoot = previousRoots?.[rootIndex];

    positionedRoots.push(
      canReuseRootEntry(previousRoot, root, nextRoot)
        ? previousRoot
        : positionRootEntry(root, nextRoot),
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

function positionRootEntry(root: RootEntry, nextRoot: RootEntry): RootEntry {
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

function canReuseRootEntry(
  previousRoot: RootEntry | undefined,
  root: RootEntry,
  nextRoot: RootEntry,
): previousRoot is RootEntry {
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

function shiftEditorBlocks(blocks: BlockEntry[], delta: number, blockArrayStart: number) {
  return blocks.map<BlockEntry>((block, index) => ({
    ...block,
    blockArrayIndex: blockArrayStart + index,
    end: block.end + delta,
    start: block.start + delta,
  }));
}

function shiftEditorRegions(regions: RegionEntry[], delta: number, regionArrayStart: number) {
  return regions.map<RegionEntry>((region, index) => ({
    ...region,
    documentOrder: regionArrayStart + index,
    end: region.end + delta,
    start: region.start + delta,
  }));
}
