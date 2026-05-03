// DocumentIndex construction: builds the flattened runtime representation
// (roots, blocks, regions, indexes) from a Document.
import {
  createDocument,
  createParagraphTextBlock,
  replaceDocumentBlock,
  resolveCommentThread,
  type Block,
  type Document,
  type Inline,
} from "@/document";
import { getCommentState } from "../../anchors";
import type {
  EditorBlock,
  EditorInline,
  EditorListItemMarker,
  DocumentIndex,
  EditorRegion,
  EditorRoot,
  RuntimeLinkAttributes,
} from "./types";
import { createTableCellRegionKey, INLINE_OBJECT_REPLACEMENT_TEXT } from "./shared";

export function createDocumentIndex(document: Document): DocumentIndex {
  const runtimeDocument = createRuntimeEditableDocument(document);
  const roots = buildEditorRoots(
    runtimeDocument.blocks.map((block, rootIndex) => createEditorRoot(block, rootIndex)),
  );

  return createResolvedDocumentIndex(runtimeDocument, roots);
}

export function createDocumentFromIndex(documentIndex: DocumentIndex): Document {
  const commentState = getCommentState(documentIndex);

  return createDocument(
    collapseRuntimeEditableDocument(documentIndex.document).blocks,
    commentState.threads,
    documentIndex.document.frontMatter,
  );
}

export function createEditorRoot(rootBlock: Block, rootIndex: number): EditorRoot {
  const blocks: EditorBlock[] = [];
  const regions: EditorRegion[] = [];
  const textParts: string[] = [];
  // Collected during the inline walk below, alongside the work that's
  // already happening — no extra traversal.
  const imageUrls = new Set<string>();
  let position = 0;

  function appendRegion(
    block: Block,
    path: string,
    inlines: EditorInline[],
    semanticRegionId: string,
    tableCellPosition: { cellIndex: number; rowIndex: number } | null = null,
  ) {
    if (regions.length > 0) {
      textParts.push("\n");
      position += 1;
    }

    const text = inlines.map((run) => run.text).join("");
    const start = position;
    const end = start + text.length;

    textParts.push(text);
    position = end;
    for (const run of inlines) {
      if (run.image) imageUrls.add(run.image.url);
    }
    regions.push({
      blockId: block.id,
      blockType: block.type,
      end,
      id: `${block.id}:${path}`,
      path,
      rootIndex,
      inlines,
      semanticRegionId,
      start,
      tableCellPosition,
      text,
    });
  }

  function visitBlock(block: Block, path: string, depth: number, parentBlockId: string | null) {
    const blockEntry: EditorBlock = {
      childBlockIds: [],
      depth,
      end: position,
      id: block.id,
      parentBlockId,
      path,
      regionIds: [],
      rootIndex,
      start: position,
      type: block.type,
    };

    blocks.push(blockEntry);

    switch (block.type) {
      case "blockquote":
      case "listItem":
        for (const [index, child] of block.children.entries()) {
          blockEntry.childBlockIds.push(child.id);
          visitBlock(child, `${path}.children.${index}`, depth + 1, block.id);
        }
        break;
      case "code": {
        appendRegion(
          block,
          `${path}.source`,
          [
            {
              end: block.source.length,
              id: `${block.id}:code`,
              image: null,
              inlineCode: false,
              kind: "text",
              link: null,
              marks: [],
              originalType: null,
              start: 0,
              text: block.source,
            },
          ],
          block.id,
        );
        blockEntry.regionIds.push(regions.at(-1)!.id);
        break;
      }
      case "heading":
      case "paragraph":
        appendRegion(block, `${path}.children`, flattenInlineNodes(block.children), block.id);
        blockEntry.regionIds.push(regions.at(-1)!.id);
        break;
      case "list":
        for (const [index, child] of block.items.entries()) {
          blockEntry.childBlockIds.push(child.id);
          visitBlock(child, `${path}.children.${index}`, depth + 1, block.id);
        }
        break;
      case "table":
        for (const [rowIndex, row] of block.rows.entries()) {
          for (const [cellIndex, cell] of row.cells.entries()) {
            appendRegion(
              block,
              `${path}.rows.${rowIndex}.cells.${cellIndex}`,
              flattenInlineNodes(cell.children),
              cell.id,
              { cellIndex, rowIndex },
            );
            blockEntry.regionIds.push(regions.at(-1)!.id);
          }
        }
        break;
      case "divider":
        // Inert leaf block: contributes no region. Inertness is structural
        // — a leaf block (not a container) with no regions. The property
        // falls out of skipping `appendRegion` here, so future inert types
        // (image-as-block, embed, display-math) qualify automatically.
        // Layout and planner reserve a fixed-height geometry slot for
        // inert leaves; the canvas paints chrome via `paintInertBlock`.
        // Deletion of an inert neighbor is handled by a dedicated branch
        // in `boundary-collapse.ts`. Caret navigation, hit testing, and
        // the universal merge-collapse rule treat inert blocks correctly
        // by virtue of their absence from the region-flow.
        break;
      case "directive":
        break;
      case "raw":
        appendRegion(
          block,
          `${path}.source`,
          [
            {
              end: block.source.length,
              id: `${block.id}:raw`,
              image: null,
              inlineCode: false,
              kind: "raw",
              link: null,
              marks: [],
              originalType: block.originalType,
              start: 0,
              text: block.source,
            },
          ],
          block.id,
        );
        blockEntry.regionIds.push(regions.at(-1)!.id);
        break;
    }

    blockEntry.end = position;
  }

  visitBlock(rootBlock, `root.${rootIndex}`, 0, null);

  return {
    blockRange: {
      end: blocks.length,
      start: 0,
    },
    blocks,
    end: position,
    imageUrls,
    length: position,
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
    text: textParts.join(""),
  };
}

export function rebuildEditorRoot(root: EditorRoot, rootBlock: Block): EditorRoot {
  return createEditorRoot(rootBlock, root.rootIndex);
}

export function buildEditorRoots(roots: EditorRoot[], previousRoots: EditorRoot[] | null = null) {
  const positionedRoots: EditorRoot[] = [];
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
      end: position + root.length,
      regionRange:
        root.regions.length > 0
          ? {
              end: regionIndex + root.regions.length,
              start: regionIndex,
            }
          : undefined,
      start: position,
    } satisfies EditorRoot;
    const previousRoot = previousRoots?.[rootIndex];

    positionedRoots.push(
      canReuseEditorRoot(previousRoot, root, nextRoot)
        ? previousRoot
        : positionEditorRoot(root, nextRoot),
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

export function spliceDocumentIndex(
  model: DocumentIndex,
  nextDocument: Document,
  rootIndex: number,
  count: number,
): DocumentIndex {
  const replacementCount = nextDocument.blocks.length - (model.roots.length - count);

  if (replacementCount < 0) {
    throw new Error("Editor model splice received an invalid replacement count.");
  }

  if (rootIndex === model.roots.length && replacementCount === 1) {
    const rootBlock = nextDocument.blocks[rootIndex];

    if (rootBlock) {
      return appendDocumentIndexRoot(model, nextDocument, rootBlock);
    }
  }

  const canPreserveSuffixRoots = replacementCount === count;
  const roots = [
    ...model.roots.slice(0, rootIndex),
    ...nextDocument.blocks
      .slice(rootIndex, rootIndex + replacementCount)
      .map((block, index) => createEditorRoot(block, rootIndex + index)),
    ...(canPreserveSuffixRoots
      ? model.roots.slice(rootIndex + count)
      : nextDocument.blocks
          .slice(rootIndex + replacementCount)
          .map((block, index) => createEditorRoot(block, rootIndex + replacementCount + index))),
  ];
  const nextRoots = buildEditorRoots(roots, model.roots);

  // Future optimization: same-count root splices can preserve more resolved indexes
  // and update only the affected suffix instead of rebuilding the full model indexes.
  return createResolvedDocumentIndex(nextDocument, nextRoots, model);
}

function appendDocumentIndexRoot(
  model: DocumentIndex,
  nextDocument: Document,
  rootBlock: Block,
): DocumentIndex {
  const rootIndex = model.roots.length;
  const root = createEditorRoot(rootBlock, rootIndex);
  const hasVisibleRootBefore = model.roots.some((candidate) => candidate.regions.length > 0);
  const start = root.regions.length > 0 && hasVisibleRootBefore ? model.length + 1 : model.length;
  const positionedRoot = positionEditorRoot(root, {
    ...root,
    blockRange: {
      end: model.blocks.length + root.blocks.length,
      start: model.blocks.length,
    },
    end: start + root.length,
    regionRange:
      root.regions.length > 0
        ? {
            end: model.regions.length + root.regions.length,
            start: model.regions.length,
          }
        : undefined,
    start,
  });
  const blocks = [...model.blocks, ...positionedRoot.blocks];
  const regions = [...model.regions, ...positionedRoot.regions];

  return {
    blockIndex: appendBlockIndex(model.blockIndex, positionedRoot.blocks),
    blocks,
    commentContainerIndex:
      nextDocument.comments === model.document.comments
        ? model.commentContainerIndex
        : createCommentContainerIndex(nextDocument),
    document: nextDocument,
    engine: "canvas",
    imageUrls: appendDocumentImageUrls(model.imageUrls, positionedRoot.imageUrls),
    length: positionedRoot.end,
    listItemMarkers:
      nextDocument.blocks === model.document.blocks
        ? model.listItemMarkers
        : appendListItemMarkerIndex(model.listItemMarkers, rootBlock),
    regionIndex: appendRegionIndex(model.regionIndex, positionedRoot.regions),
    regionOrderIndex: appendRegionOrderIndex(
      model.regionOrderIndex,
      positionedRoot.regions,
      model.regions.length,
    ),
    regionPathIndex: appendRegionPathIndex(model.regionPathIndex, positionedRoot.regions),
    regions,
    roots: [...model.roots, positionedRoot],
    tableCellIndex: appendTableCellIndex(model.tableCellIndex, positionedRoot.regions),
    tableCellRegionIndex: appendTableCellRegionIndex(
      model.tableCellRegionIndex,
      positionedRoot.regions,
    ),
    text: appendDocumentIndexText(model.text, positionedRoot),
  };
}

export function replaceIndexedDocument(model: DocumentIndex, document: Document): DocumentIndex {
  if (document.blocks !== model.document.blocks) {
    throw new Error("Editor model document replacement requires preserving root blocks.");
  }

  return createResolvedDocumentIndex(document, model.roots, model);
}

export function replaceEditorBlock(
  documentIndex: DocumentIndex,
  targetBlockId: string,
  replacer: (block: Block) => Block | null,
): Document | null {
  const blockEntry = documentIndex.blockIndex.get(targetBlockId);

  if (!blockEntry) {
    return null;
  }

  return replaceDocumentBlock(documentIndex.document, targetBlockId, replacer, blockEntry.rootIndex);
}

function createResolvedDocumentIndex(
  document: Document,
  roots: EditorRoot[],
  previousModel: DocumentIndex | null = null,
): DocumentIndex {
  const blocks = roots.flatMap((root) => root.blocks);
  const regions = roots.flatMap((root) => root.regions);
  const { regionIndex, regionOrderIndex, regionPathIndex, tableCellIndex, tableCellRegionIndex } =
    createRegionIndexes(regions);

  return {
    blockIndex: createBlockIndex(blocks),
    blocks,
    commentContainerIndex:
      document.comments === previousModel?.document.comments
        ? previousModel.commentContainerIndex
        : createCommentContainerIndex(document),
    document,
    engine: "canvas",
    imageUrls: createDocumentImageUrls(roots, previousModel?.imageUrls),
    length: roots.at(-1)?.end ?? 0,
    listItemMarkers:
      document.blocks === previousModel?.document.blocks
        ? previousModel.listItemMarkers
        : createListItemMarkers(document.blocks),
    regionIndex,
    regionOrderIndex,
    regionPathIndex,
    regions,
    roots,
    tableCellIndex,
    tableCellRegionIndex,
    text: createDocumentIndexText(roots),
  };
}

function positionEditorRoot(root: EditorRoot, nextRoot: EditorRoot): EditorRoot {
  const delta = nextRoot.start - root.start;

  return {
    ...nextRoot,
    blocks: delta === 0 ? root.blocks : shiftEditorBlocks(root.blocks, delta),
    regions: delta === 0 ? root.regions : shiftEditorRegions(root.regions, delta),
  };
}

function canReuseEditorRoot(
  previousRoot: EditorRoot | undefined,
  root: EditorRoot,
  nextRoot: EditorRoot,
): previousRoot is EditorRoot {
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

function shiftEditorBlocks(blocks: EditorBlock[], delta: number) {
  return blocks.map<EditorBlock>((block) => ({
    ...block,
    end: block.end + delta,
    start: block.start + delta,
  }));
}

function shiftEditorRegions(regions: EditorRegion[], delta: number) {
  return regions.map<EditorRegion>((region) => ({
    ...region,
    end: region.end + delta,
    start: region.start + delta,
  }));
}

function createBlockIndex(blocks: EditorBlock[]) {
  const blockIndex = new Map<string, EditorBlock>();

  for (const block of blocks) {
    blockIndex.set(block.id, block);
  }

  return blockIndex;
}

function createRegionIndexes(regions: EditorRegion[]) {
  const regionIndex = new Map<string, EditorRegion>();
  const regionOrderIndex = new Map<string, number>();
  const regionPathIndex = new Map<string, EditorRegion>();
  const tableCellIndex = new Map<string, { cellIndex: number; rowIndex: number }>();
  const tableCellRegionIndex = new Map<string, string>();

  for (const [index, region] of regions.entries()) {
    regionIndex.set(region.id, region);
    regionOrderIndex.set(region.id, index);
    regionPathIndex.set(region.path, region);

    if (!region.tableCellPosition) {
      continue;
    }

    tableCellIndex.set(region.id, region.tableCellPosition);
    tableCellRegionIndex.set(
      createTableCellRegionKey(
        region.blockId,
        region.tableCellPosition.rowIndex,
        region.tableCellPosition.cellIndex,
      ),
      region.id,
    );
  }

  return {
    regionIndex,
    regionOrderIndex,
    regionPathIndex,
    tableCellIndex,
    tableCellRegionIndex,
  };
}

function appendBlockIndex(blockIndex: DocumentIndex["blockIndex"], blocks: EditorBlock[]) {
  const nextBlockIndex = new Map(blockIndex);

  for (const block of blocks) {
    nextBlockIndex.set(block.id, block);
  }

  return nextBlockIndex;
}

function appendRegionIndex(regionIndex: DocumentIndex["regionIndex"], regions: EditorRegion[]) {
  const nextRegionIndex = new Map(regionIndex);

  for (const region of regions) {
    nextRegionIndex.set(region.id, region);
  }

  return nextRegionIndex;
}

function appendRegionOrderIndex(
  regionOrderIndex: DocumentIndex["regionOrderIndex"],
  regions: EditorRegion[],
  startIndex: number,
) {
  const nextRegionOrderIndex = new Map(regionOrderIndex);

  for (const [index, region] of regions.entries()) {
    nextRegionOrderIndex.set(region.id, startIndex + index);
  }

  return nextRegionOrderIndex;
}

function appendRegionPathIndex(
  regionPathIndex: DocumentIndex["regionPathIndex"],
  regions: EditorRegion[],
) {
  const nextRegionPathIndex = new Map(regionPathIndex);

  for (const region of regions) {
    nextRegionPathIndex.set(region.path, region);
  }

  return nextRegionPathIndex;
}

function appendTableCellIndex(
  tableCellIndex: DocumentIndex["tableCellIndex"],
  regions: EditorRegion[],
) {
  const nextTableCellIndex = new Map(tableCellIndex);

  for (const region of regions) {
    if (region.tableCellPosition) {
      nextTableCellIndex.set(region.id, region.tableCellPosition);
    }
  }

  return nextTableCellIndex;
}

function appendTableCellRegionIndex(
  tableCellRegionIndex: DocumentIndex["tableCellRegionIndex"],
  regions: EditorRegion[],
) {
  const nextTableCellRegionIndex = new Map(tableCellRegionIndex);

  for (const region of regions) {
    if (!region.tableCellPosition) {
      continue;
    }

    nextTableCellRegionIndex.set(
      createTableCellRegionKey(
        region.blockId,
        region.tableCellPosition.rowIndex,
        region.tableCellPosition.cellIndex,
      ),
      region.id,
    );
  }

  return nextTableCellRegionIndex;
}

function appendListItemMarkerIndex(
  listItemMarkers: DocumentIndex["listItemMarkers"],
  rootBlock: Block,
) {
  const nextListItemMarkers = new Map(listItemMarkers);
  appendListItemMarkers(nextListItemMarkers, [rootBlock]);

  return nextListItemMarkers;
}

function appendDocumentIndexText(text: string, root: EditorRoot) {
  if (root.regions.length === 0) {
    return text;
  }

  return text.length > 0 ? `${text}\n${root.text}` : root.text;
}

function createDocumentIndexText(roots: EditorRoot[]) {
  return roots
    .filter((root) => root.regions.length > 0)
    .map((root) => root.text)
    .join("\n");
}

// Builds the document-level union of image URLs from per-root sets,
// reusing the previous index's reference when the URL set is unchanged so
// downstream consumers (notably the image loader hook's effect dep) can
// short-circuit on identity.
function createDocumentImageUrls(
  roots: EditorRoot[],
  previous: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
  const next = new Set<string>();
  for (const root of roots) {
    for (const url of root.imageUrls) next.add(url);
  }
  return previous && areUrlSetsEqual(previous, next) ? previous : next;
}

// Append-path counterpart: returns `existing` unchanged when the appended
// root introduces no new URLs (the common case for non-image edits), and
// only allocates a new Set when there's actually a delta.
function appendDocumentImageUrls(
  existing: ReadonlySet<string>,
  rootImageUrls: ReadonlySet<string>,
): ReadonlySet<string> {
  if (rootImageUrls.size === 0) return existing;

  let next: Set<string> | null = null;
  for (const url of rootImageUrls) {
    if (existing.has(url)) continue;
    next ??= new Set(existing);
    next.add(url);
  }
  return next ?? existing;
}

function areUrlSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function createCommentContainerIndex(document: Document) {
  const commentContainerIndex = new Map<string, number[]>();

  for (const [threadIndex, thread] of document.comments.entries()) {
    const containerId = resolveCommentThread(thread, document).match?.containerId ?? null;

    if (!containerId) {
      continue;
    }

    const threadIndices = commentContainerIndex.get(containerId) ?? [];
    threadIndices.push(threadIndex);
    commentContainerIndex.set(containerId, threadIndices);
  }

  return commentContainerIndex;
}

function createListItemMarkers(blocks: Block[]) {
  const markers = new Map<string, EditorListItemMarker>();
  appendListItemMarkers(markers, blocks);

  return markers;
}

function appendListItemMarkers(
  markers: Map<string, EditorListItemMarker>,
  blocks: Block[],
  orderedContext: { index: number; ordered: boolean; start: number | null } | null = null,
) {
  for (const block of blocks) {
    if (block.type === "list") {
      for (const [index, child] of block.items.entries()) {
        appendListItemMarkers(markers, [child], {
          index,
          ordered: block.ordered,
          start: block.start,
        });
      }

      continue;
    }

    if (block.type === "listItem") {
      if (typeof block.checked === "boolean") {
        markers.set(block.id, {
          checked: block.checked,
          kind: "task",
        });
      } else if (orderedContext?.ordered) {
        markers.set(block.id, {
          kind: "ordered",
          label: `${(orderedContext.start ?? 1) + orderedContext.index}.`,
        });
      } else {
        markers.set(block.id, {
          kind: "bullet",
          label: "\u2022",
        });
      }

      appendListItemMarkers(markers, block.children, orderedContext);
    }

    if (block.type === "blockquote") {
      appendListItemMarkers(markers, block.children, orderedContext);
    }
  }
}

function createRuntimeEditableDocument(document: Document): Document {
  if (document.blocks.length > 0) {
    return document;
  }

  return createDocument(
    [createParagraphTextBlock({ text: "" })],
    document.comments,
    document.frontMatter,
  );
}

function collapseRuntimeEditableDocument(document: Document): Document {
  const firstBlock = document.blocks[0];

  if (
    document.blocks.length !== 1 ||
    !firstBlock ||
    firstBlock.type !== "paragraph" ||
    firstBlock.children.length > 0
  ) {
    return document;
  }

  return createDocument([], document.comments, document.frontMatter);
}

function flattenInlineNodes(
  nodes: Inline[],
  link: RuntimeLinkAttributes | null = null,
): EditorInline[] {
  const inlines: EditorInline[] = [];
  let position = 0;

  const pushRun = (run: Omit<EditorInline, "end" | "start">) => {
    const start = position;
    const end = start + run.text.length;

    inlines.push({
      ...run,
      end,
      start,
    });
    position = end;
  };

  for (const node of nodes) {
    switch (node.type) {
      case "lineBreak":
        pushRun({
          id: node.id,
          image: null,
          inlineCode: false,
          kind: "lineBreak",
          link,
          marks: [],
          originalType: null,
          text: "\n",
        });
        break;
      case "image":
        pushRun({
          id: node.id,
          image: {
            alt: node.alt,
            title: node.title,
            url: node.url,
            width: node.width,
          },
          inlineCode: false,
          kind: "image",
          link,
          marks: [],
          originalType: null,
          text: resolveImageRunText(node.alt),
        });
        break;
      case "code":
        pushRun({
          id: node.id,
          image: null,
          inlineCode: true,
          kind: "code",
          link,
          marks: [],
          originalType: null,
          text: node.code,
        });
        break;
      case "link":
        for (const childRun of flattenInlineNodes(node.children, {
          title: node.title,
          url: node.url,
        })) {
          pushRun(childRun);
        }
        break;
      case "text":
        pushRun({
          id: node.id,
          image: null,
          inlineCode: false,
          kind: "text",
          link,
          marks: node.marks,
          originalType: null,
          text: node.text,
        });
        break;
      case "raw":
        pushRun({
          id: node.id,
          image: null,
          inlineCode: false,
          kind: "raw",
          link,
          marks: [],
          originalType: node.originalType,
          text: node.source,
        });
        break;
    }
  }

  return inlines;
}

function resolveImageRunText(alt: string | null) {
  void alt;

  return INLINE_OBJECT_REPLACEMENT_TEXT;
}
