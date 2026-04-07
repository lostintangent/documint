// Projects the semantic Document into the editor's working shape.
//
// In this model:
// - blocks preserve structural ancestry for editing semantics
// - regions are the addressable editable text regions within that structure
// - runs segment a region's text by inline semantics such as links, marks,
//   inline code, images, and unsupported spans
//
// Regions are not one-to-one with blocks. A paragraph or heading usually
// produces one region, while a table block produces one region per cell,
// and structural blocks like lists and blockquotes produce child blocks rather
// than a direct editable region of their own.
import {
  buildDocument,
  createCode as createDocumentInlineCodeNode,
  createLineBreak as createDocumentLineBreakNode,
  createLink as createDocumentLinkNode,
  createParagraphTextBlock,
  createTableCell as createDocumentTableCell,
  createText as createDocumentTextNode,
  createRaw as createDocumentUnsupportedInlineNode,
  extractPlainTextFromBlockNodes,
  extractPlainTextFromInlineNodes,
  spliceDocument,
  rebuildCodeBlock,
  rebuildTableBlock,
  rebuildTextBlock,
  rebuildRawBlock,
  type Block,
  type Document,
  type HeadingBlock,
  type Code,
  type Inline,
  type Mark,
  type ParagraphBlock,
  type TableBlock,
  type TableCell,
  type Text,
  type Raw,
} from "@/document";
import { repairCommentThread } from "@/comments";
import { getCommentState, updateCommentThreadsForRegionEdit } from "../comments";

export type EditorEngine = "canvas";

export type RuntimeLinkAttributes = {
  title: string | null;
  url: string;
};

export type RuntimeImageAttributes = {
  alt: string | null;
  title: string | null;
  url: string;
  width: number | null;
};

export type DocumentEditorTextRun = {
  end: number;
  image: RuntimeImageAttributes | null;
  id: string;
  inlineCode: boolean;
  kind: "break" | "image" | "inlineCode" | "text" | "unsupported";
  link: RuntimeLinkAttributes | null;
  marks: Mark[];
  start: number;
  text: string;
};

export type DocumentListItemMarker =
  | { checked: boolean; kind: "task" }
  | { kind: "bullet"; label: "\u2022" }
  | { kind: "ordered"; label: string };

export type DocumentEditorRegion = {
  blockId: string;
  blockType: Block["type"];
  end: number;
  id: string;
  path: string;
  rootIndex: number;
  runs: DocumentEditorTextRun[];
  semanticRegionId: string;
  start: number;
  text: string;
};

export type DocumentEditorBlock = {
  childBlockIds: string[];
  regionIds: string[];
  depth: number;
  end: number;
  id: string;
  parentBlockId: string | null;
  path: string;
  plainText: string;
  rootIndex: number;
  start: number;
  type: Block["type"];
};

export type DocumentEditor = {
  blockIndex: Map<string, DocumentEditorBlock>;
  blocks: DocumentEditorBlock[];
  commentContainerIndex: Map<string, number[]>;
  regionIndex: Map<string, DocumentEditorRegion>;
  regions: DocumentEditorRegion[];
  engine: "canvas";
  document: Document;
  length: number;
  listItemMarkers: Map<string, DocumentListItemMarker>;
  tableCellIndex: Map<string, { cellIndex: number; rowIndex: number }>;
  text: string;
};

export type DocumentEditorAdapter<State> = {
  createDocument: (state: State) => Document;
  createState: (document: Document) => State;
  engine: EditorEngine;
};

export type CanvasSelectionPoint = {
  regionId: string;
  offset: number;
};

export type CanvasSelection = {
  anchor: CanvasSelectionPoint;
  focus: CanvasSelectionPoint;
};

export type NormalizedCanvasSelection = {
  end: CanvasSelectionPoint;
  start: CanvasSelectionPoint;
};

export type RegionRangePathSelectionTarget = {
  endOffset: number;
  kind: "region-range-path";
  path: string;
  startOffset: number;
};

export type EditorSelectionTarget = {
  kind: "descendant-primary-region";
  childIndices: number[];
  offset: number | "end";
  rootIndex: number;
} | {
  kind: "region-path";
  offset: number | "end";
  path: string;
} | RegionRangePathSelectionTarget | {
  kind: "root-primary-region";
  offset: number | "end";
  rootIndex: number;
} | {
  cellIndex: number;
  kind: "table-cell";
  offset: number | "end";
  rootIndex: number;
  rowIndex: number;
};

export type InlineCommandTarget =
  | {
      block: HeadingBlock | ParagraphBlock;
      children: Inline[];
      kind: "inlineBlock";
      path: string;
    }
  | {
      block: TableBlock;
      blockPath: string;
      cell: TableCell;
      children: Inline[];
      kind: "tableCell";
      path: string;
    };

export type InlineCommandReplacement = {
  block: Block;
  blockId: string;
  selection: RegionRangePathSelectionTarget;
};

const INLINE_OBJECT_REPLACEMENT_TEXT = "\uFFFC";

export function createDocumentEditor(document: Document): DocumentEditor {
  const runtimeDocument = createRuntimeEditableDocument(document);
  const blocks: DocumentEditorBlock[] = [];
  const commentContainerIndex = new Map<string, number[]>();
  const regions: DocumentEditorRegion[] = [];
  const tableCellIndex = new Map<string, { cellIndex: number; rowIndex: number }>();
  const textParts: string[] = [];
  let position = 0;

  function appendRegion(
    block: Block,
    path: string,
    runs: DocumentEditorTextRun[],
    semanticRegionId: string,
    rootIndex: number,
    tableCellPosition: { cellIndex: number; rowIndex: number } | null = null,
  ) {
    if (regions.length > 0) {
      textParts.push("\n");
      position += 1;
    }

    const text = runs.map((run) => run.text).join("");
    const start = position;
    const end = start + text.length;

    textParts.push(text);
    position = end;
    regions.push({
      blockId: block.id,
      blockType: block.type,
      end,
      id: `${block.id}:${path}`,
      path,
      rootIndex,
      runs,
      semanticRegionId,
      start,
      text,
    });

    if (tableCellPosition) {
      tableCellIndex.set(regions.at(-1)!.id, tableCellPosition);
    }
  }

  function visitBlock(
    block: Block,
    path: string,
    depth: number,
    parentBlockId: string | null,
    rootIndex: number,
  ) {
    const blockEntry: DocumentEditorBlock = {
      childBlockIds: [],
      regionIds: [],
      depth,
      end: position,
      id: block.id,
      parentBlockId,
      path,
      plainText: block.plainText,
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
          visitBlock(child, `${path}.children.${index}`, depth + 1, block.id, rootIndex);
        }
        break;
      case "code": {
        appendRegion(block, `${path}.value`, [
          {
            end: block.value.length,
            image: null,
            id: `${block.id}:code`,
            inlineCode: false,
            kind: "text",
            link: null,
            marks: [],
            start: 0,
            text: block.value,
          },
        ], block.id, rootIndex);
        blockEntry.regionIds.push(regions.at(-1)!.id);
        break;
      }
      case "heading":
      case "paragraph": {
        appendRegion(block, `${path}.children`, flattenInlineNodes(block.children), block.id, rootIndex);
        blockEntry.regionIds.push(regions.at(-1)!.id);
        break;
      }
      case "list":
        for (const [index, child] of block.children.entries()) {
          blockEntry.childBlockIds.push(child.id);
          visitBlock(child, `${path}.children.${index}`, depth + 1, block.id, rootIndex);
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
              rootIndex,
              { cellIndex, rowIndex },
            );
            blockEntry.regionIds.push(regions.at(-1)!.id);
          }
        }
        break;
      case "thematicBreak":
        break;
      case "unsupported":
        appendRegion(block, `${path}.raw`, [
          {
            end: block.raw.length,
            image: null,
            id: `${block.id}:unsupported`,
            inlineCode: false,
            kind: "unsupported",
            link: null,
            marks: [],
            start: 0,
            text: block.raw,
          },
        ], block.id, rootIndex);
        blockEntry.regionIds.push(regions.at(-1)!.id);
        break;
    }

    blockEntry.end = position;
  }

  for (const [index, block] of runtimeDocument.blocks.entries()) {
    visitBlock(block, `root.${index}`, 0, null, index);
  }

  for (const [threadIndex, thread] of runtimeDocument.comments.entries()) {
    const containerId = repairCommentThread(thread, runtimeDocument).match?.containerId ?? null;

    if (!containerId) {
      continue;
    }

    const threadIndices = commentContainerIndex.get(containerId) ?? [];
    threadIndices.push(threadIndex);
    commentContainerIndex.set(containerId, threadIndices);
  }

  return {
    blockIndex: new Map(blocks.map((block) => [block.id, block])),
    blocks,
    commentContainerIndex,
    regionIndex: new Map(regions.map((container) => [container.id, container])),
    regions,
    document: runtimeDocument,
    engine: "canvas",
    length: position,
    listItemMarkers: createListItemMarkers(runtimeDocument.blocks),
    tableCellIndex,
    text: textParts.join(""),
  };
}

export function createDocumentFromEditor(
  documentEditor: DocumentEditor,
): Document {
  const commentState = getCommentState(documentEditor);

  return buildDocument({
    blocks: collapseRuntimeEditableDocument(documentEditor.document).blocks,
    comments: commentState.threads,
  });
}

function createRuntimeEditableDocument(document: Document): Document {
  if (document.blocks.length > 0) {
    return document;
  }

  return buildDocument({
    blocks: [createParagraphTextBlock({ text: "" })],
    comments: document.comments,
  });
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

  return buildDocument({
    blocks: [],
    comments: document.comments,
  });
}

export function createDocumentEditorAdapter(): DocumentEditorAdapter<
  DocumentEditor
> {
  return {
    createDocument: createDocumentFromEditor,
    createState: createDocumentEditor,
    engine: "canvas",
  };
}

export function normalizeCanvasSelection(
  documentEditor: DocumentEditor,
  selection: CanvasSelection,
): NormalizedCanvasSelection {
  const anchorOrder = resolveSelectionOrder(documentEditor, selection.anchor);
  const focusOrder = resolveSelectionOrder(documentEditor, selection.focus);

  if (anchorOrder <= focusOrder) {
    return {
      end: selection.focus,
      start: selection.anchor,
    };
  }

  return {
    end: selection.anchor,
    start: selection.focus,
  };
}

export function resolveSelectionTarget(
  documentEditor: DocumentEditor,
  selection: CanvasSelection | EditorSelectionTarget | null,
) {
  if (!selection) {
    return null;
  }

  if ("kind" in selection) {
    if (selection.kind === "root-primary-region") {
      const block = documentEditor.document.blocks[selection.rootIndex];
      const region = block ? resolvePrimaryRegion(documentEditor, block) : null;

      return region ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset)) : null;
    }

    if (selection.kind === "descendant-primary-region") {
      const rootBlock = documentEditor.document.blocks[selection.rootIndex];
      const block = rootBlock
        ? resolveDescendantBlock(rootBlock, selection.childIndices)
        : null;
      const region = block ? resolvePrimaryRegion(documentEditor, block) : null;

      return region ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset)) : null;
    }

    if (selection.kind === "table-cell") {
      const rootBlock = documentEditor.document.blocks[selection.rootIndex];

      if (!rootBlock || rootBlock.type !== "table") {
        return null;
      }

      const region = documentEditor.regions.find(
        (entry) =>
          entry.blockId === rootBlock.id &&
          documentEditor.tableCellIndex.get(entry.id)?.rowIndex === selection.rowIndex &&
          documentEditor.tableCellIndex.get(entry.id)?.cellIndex === selection.cellIndex,
      );

      return region
        ? createCollapsedSelection(region.id, resolveRegionOffset(region.text, selection.offset))
        : null;
    }

    const region = documentEditor.regions.find((entry) => entry.path === selection.path);

    if (!region) {
      return null;
    }

    if (selection.kind === "region-path") {
      return createCollapsedSelection(
        region.id,
        resolveRegionOffset(region.text, selection.offset),
      );
    }

    return {
      anchor: {
        regionId: region.id,
        offset: Math.max(0, Math.min(selection.startOffset, region.text.length)),
      },
      focus: {
        regionId: region.id,
        offset: Math.max(0, Math.min(selection.endOffset, region.text.length)),
      },
    };
  }

  return selection;
}

export function replaceText(
  documentEditor: DocumentEditor,
  selection: CanvasSelection,
  text: string,
) {
  const normalized = normalizeCanvasSelection(documentEditor, selection);

  if (normalized.start.regionId !== normalized.end.regionId) {
    throw new Error("Cross-region canvas text replacement is not supported yet.");
  }

  const region = documentEditor.regions.find(
    (entry) => entry.id === normalized.start.regionId,
  );

  if (!region) {
    throw new Error(`Unknown canvas region: ${normalized.start.regionId}`);
  }

  const rootBlock = documentEditor.document.blocks[region.rootIndex];

  if (!rootBlock) {
    throw new Error(`Unknown canvas root block at index: ${region.rootIndex}`);
  }

  const nextRootBlock = replaceBlockById(
    documentEditor,
    rootBlock,
    region.blockId,
    region,
    normalized.start.offset,
    normalized.end.offset,
    text,
  );
  const nextDocument = spliceDocument(
    documentEditor.document,
    region.rootIndex,
    1,
    [nextRootBlock],
  );
  const nextDocumentEditor = createDocumentEditor(nextDocument);
  if (documentEditor.document.comments.length === 0) {
    const nextRegion = nextDocumentEditor.regions.find((entry) => entry.path === region.path);

    if (!nextRegion) {
      throw new Error(`Failed to remap canvas region after replacement: ${region.path}`);
    }

    const nextOffset = normalized.start.offset + text.length;

    return {
      documentEditor: nextDocumentEditor,
      selection: {
        anchor: {
          regionId: nextRegion.id,
          offset: nextOffset,
        },
        focus: {
          regionId: nextRegion.id,
          offset: nextOffset,
        },
      } satisfies CanvasSelection,
    };
  }

  const nextComments = updateCommentThreadsForRegionEdit(
    documentEditor,
    nextDocumentEditor,
    region,
    normalized.start.offset,
    normalized.end.offset,
    text,
  );
  const finalizedDocumentEditor =
    nextComments === nextDocumentEditor.document.comments
      ? nextDocumentEditor
      : {
          ...nextDocumentEditor,
          document: {
            ...nextDocumentEditor.document,
            comments: nextComments,
          },
        };
  const nextRegion = finalizedDocumentEditor.regions.find((entry) => entry.path === region.path);

  if (!nextRegion) {
    throw new Error(`Failed to remap canvas region after replacement: ${region.path}`);
  }

  const nextOffset = normalized.start.offset + text.length;

  return {
    documentEditor: finalizedDocumentEditor,
    selection: {
      anchor: {
        regionId: nextRegion.id,
        offset: nextOffset,
      },
      focus: {
        regionId: nextRegion.id,
        offset: nextOffset,
      },
    } satisfies CanvasSelection,
  };
}

export function resolveInlineCommandTarget(
  block: Block,
  containerPath: string,
  semanticRegionId: string,
): InlineCommandTarget | null {
  if (block.type === "heading" || block.type === "paragraph") {
    return {
      block,
      children: block.children,
      kind: "inlineBlock",
      path: containerPath.replace(/\.children$/, ""),
    };
  }

  if (block.type !== "table") {
    return null;
  }

  const cellPathMatch = /^(.*\.rows\.\d+\.cells\.\d+)$/.exec(containerPath);

  if (!cellPathMatch) {
    return null;
  }

  for (const row of block.rows) {
    for (const cell of row.cells) {
      if (cell.id === semanticRegionId) {
        return {
          block,
          blockPath: cellPathMatch[1]!.replace(/\.rows\.\d+\.cells\.\d+$/, ""),
          cell,
          children: cell.children,
          kind: "tableCell",
          path: cellPathMatch[1]!,
        };
      }
    }
  }

  return null;
}

export function toggleInlineCodeTarget(
  target: InlineCommandTarget,
  startOffset: number,
  endOffset: number,
): InlineCommandReplacement | null {
  const nextChildren = compactInlineNodes(
    toggleInlineCodeNodes(
      target.children,
      startOffset,
      endOffset,
      `${target.path}.children`,
    ),
  );

  return nextChildren.length > 0
    ? createInlineCommandReplacement(target, nextChildren, startOffset, endOffset)
    : null;
}

export function toggleInlineMarkTarget(
  target: InlineCommandTarget,
  startOffset: number,
  endOffset: number,
  mark: Extract<Mark, "italic" | "bold" | "strikethrough" | "underline">,
): InlineCommandReplacement | null {
  const removeMark = shouldRemoveInlineMark(target.children, startOffset, endOffset, mark);

  if (removeMark === null) {
    return null;
  }

  const nextChildren = compactInlineNodes(
    toggleInlineNodesMark(
      target.children,
      startOffset,
      endOffset,
      mark,
      removeMark,
      `${target.path}.children`,
    ),
  );

  return nextChildren.length > 0
    ? createInlineCommandReplacement(target, nextChildren, startOffset, endOffset)
    : null;
}

export function insertInlineLineBreakTarget(
  target: InlineCommandTarget,
  startOffset: number,
  endOffset: number,
): InlineCommandReplacement {
  const nextChildren = compactInlineNodes(
    replaceSelectionWithInlineLineBreak(
      target.children,
      startOffset,
      endOffset,
      `${target.path}.children`,
    ),
  );

  return createInlineCommandReplacement(
    target,
    nextChildren,
    startOffset + 1,
    startOffset + 1,
  );
}

export function resolveInlineCommandMarks(
  target: InlineCommandTarget,
  startOffset: number,
  endOffset: number,
): Mark[] {
  let cursor = 0;
  let commonMarks: Set<Mark> | null = null;

  const visit = (candidates: Inline[]) => {
    for (const node of candidates) {
      const nodeLength = measureInlineNodeText(node);
      const nodeStart = cursor;
      const nodeEnd = nodeStart + nodeLength;
      cursor = nodeEnd;

      if (endOffset <= nodeStart || startOffset >= nodeEnd) {
        continue;
      }

      if (node.type === "text") {
        const overlapStart = Math.max(startOffset, nodeStart);
        const overlapEnd = Math.min(endOffset, nodeEnd);

        if (overlapEnd > overlapStart) {
          commonMarks =
            commonMarks === null
              ? new Set(node.marks)
              : new Set(node.marks.filter((mark) => commonMarks?.has(mark)));
        }

        continue;
      }

      if (node.type === "link") {
        const previousCursor = cursor;
        cursor = nodeStart;
        visit(node.children);
        cursor = previousCursor;
      }
    }
  };

  visit(target.children);

  return commonMarks ? [...commonMarks] : [];
}

export function replaceExactInlineLinkTarget(
  target: InlineCommandTarget,
  startOffset: number,
  endOffset: number,
  url: string | null,
): InlineCommandReplacement | null {
  const nextChildren = compactInlineNodes(
    replaceExactInlineLink(
      target.children,
      startOffset,
      endOffset,
      url,
      `${target.path}.children`,
    ) ?? [],
  );

  return nextChildren.length > 0
    ? createInlineCommandReplacement(target, nextChildren, startOffset, endOffset)
    : null;
}

function createListItemMarkers(blocks: Block[]) {
  const markers = new Map<string, DocumentListItemMarker>();

  const visit = (
    entries: Block[],
    orderedContext: { index: number; ordered: boolean; start: number | null } | null = null,
  ) => {
    for (const block of entries) {
      if (block.type === "list") {
        for (const [index, child] of block.children.entries()) {
          visit([child], {
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

        visit(block.children, orderedContext);
      }

      if (block.type === "blockquote") {
        visit(block.children, orderedContext);
      }
    }
  };

  visit(blocks);

  return markers;
}

function toggleInlineCodeNodes(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  path: string,
): Inline[] {
  const exactInlineCode = resolveExactSelectedInlineCode(nodes, startOffset, endOffset);

  if (exactInlineCode) {
    return replaceSelectionWithInlineCode(
      nodes,
      startOffset,
      endOffset,
      exactInlineCode.code,
      path,
      false,
    );
  }

  const selectedText = extractInlineSelectionText(nodes, startOffset, endOffset);

  if (selectedText.length === 0) {
    return nodes;
  }

  return replaceSelectionWithInlineCode(
    nodes,
    startOffset,
    endOffset,
    selectedText,
    path,
    true,
  );
}

function resolveExactSelectedInlineCode(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
): Code | null {
  let cursor = 0;

  for (const node of nodes) {
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;
    cursor = nodeEnd;

    if (startOffset === nodeStart && endOffset === nodeEnd && node.type === "inlineCode") {
      return node;
    }

    if (node.type === "link") {
      const nested = resolveExactSelectedInlineCode(
        node.children,
        Math.max(0, startOffset - nodeStart),
        Math.min(nodeLength, endOffset - nodeStart),
      );

      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function replaceSelectionWithInlineCode(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  selectedText: string,
  path: string,
  wrap: boolean,
): Inline[] {
  const nextNodes: Inline[] = [];
  let cursor = 0;
  let inserted = false;

  for (const [index, node] of nodes.entries()) {
    const nodePath = `${path}.${index}`;
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;
    cursor = nodeEnd;

    if (endOffset <= nodeStart || startOffset >= nodeEnd) {
      nextNodes.push(node);
      continue;
    }

    if (!inserted) {
      nextNodes.push(
        ...collectInlinePrefix(node, Math.max(0, startOffset - nodeStart), nodePath),
      );
      const selectedNode = wrap
        ? createPathInlineCodeNode(selectedText, `${path}.selected`)
        : createPathTextNode(selectedText, [], `${path}.selected`);

      if (selectedNode) {
        nextNodes.push(selectedNode);
      }
      inserted = true;
    }

    nextNodes.push(
      ...collectInlineSuffix(node, Math.min(nodeLength, endOffset - nodeStart), nodePath),
    );
  }

  return nextNodes;
}

function replaceSelectionWithInlineLineBreak(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  path: string,
): Inline[] {
  const nextNodes: Inline[] = [];
  let cursor = 0;
  let inserted = false;

  for (const [index, node] of nodes.entries()) {
    const nodePath = `${path}.${index}`;
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;
    cursor = nodeEnd;

    if (endOffset <= nodeStart || startOffset >= nodeEnd) {
      nextNodes.push(node);
      continue;
    }

    if (!inserted) {
      nextNodes.push(
        ...collectInlinePrefix(node, Math.max(0, startOffset - nodeStart), nodePath),
      );
      nextNodes.push(createDocumentLineBreakNode({
        path: `${path}.selected`,
      }));
      inserted = true;
    }

    nextNodes.push(
      ...collectInlineSuffix(node, Math.min(nodeLength, endOffset - nodeStart), nodePath),
    );
  }

  if (!inserted) {
    nextNodes.push(createDocumentLineBreakNode({
      path: `${path}.selected`,
    }));
  }

  return nextNodes;
}

function replaceExactInlineLink(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  url: string | null,
  path: string,
): Inline[] | null {
  const nextNodes: Inline[] = [];
  let cursor = 0;
  let didReplace = false;

  for (const [index, node] of nodes.entries()) {
    const nodePath = `${path}.${index}`;
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;
    cursor = nodeEnd;

    if (
      !didReplace &&
      node.type === "link" &&
      startOffset === nodeStart &&
      endOffset === nodeEnd
    ) {
      if (url === null) {
        nextNodes.push(...node.children);
      } else {
        nextNodes.push(createDocumentLinkNode({
          children: node.children,
          path: nodePath,
          title: node.title,
          url,
        }));
      }

      didReplace = true;
      continue;
    }

    nextNodes.push(node);
  }

  return didReplace ? nextNodes : null;
}

function extractInlineSelectionText(nodes: Inline[], startOffset: number, endOffset: number): string {
  let cursor = 0;
  let text = "";

  for (const node of nodes) {
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;
    cursor = nodeEnd;

    if (endOffset <= nodeStart || startOffset >= nodeEnd) {
      continue;
    }

    text += extractInlineNodeSlice(
      node,
      Math.max(0, startOffset - nodeStart),
      Math.min(nodeLength, endOffset - nodeStart),
    );
  }

  return text;
}

function collectInlinePrefix(node: Inline, offset: number, path: string): Inline[] {
  if (offset <= 0) {
    return [];
  }

  return sliceInlineNode(node, 0, offset, `${path}.before`);
}

function collectInlineSuffix(node: Inline, offset: number, path: string): Inline[] {
  const nodeLength = measureInlineNodeText(node);

  if (offset >= nodeLength) {
    return [];
  }

  return sliceInlineNode(node, offset, nodeLength, `${path}.after`);
}

function sliceInlineNode(node: Inline, startOffset: number, endOffset: number, path: string): Inline[] {
  if (startOffset >= endOffset) {
    return [];
  }

  switch (node.type) {
    case "text":
      return compactInlineNodes([
        createPathTextNode(node.text.slice(startOffset, endOffset), node.marks, path),
      ].filter(Boolean) as Text[]);
    case "inlineCode":
      return [createPathInlineCodeNode(node.code.slice(startOffset, endOffset), path)];
    case "link": {
      const children = compactInlineNodes(
        sliceInlineChildren(node.children, startOffset, endOffset, `${path}.children`),
      );
      return children.length > 0 ? [{ ...node, children }] : [];
    }
    default:
      return [];
  }
}

function sliceInlineChildren(nodes: Inline[], startOffset: number, endOffset: number, path: string) {
  const sliced: Inline[] = [];
  let cursor = 0;

  for (const [index, node] of nodes.entries()) {
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;
    cursor = nodeEnd;

    if (endOffset <= nodeStart || startOffset >= nodeEnd) {
      continue;
    }

    sliced.push(
      ...sliceInlineNode(
        node,
        Math.max(0, startOffset - nodeStart),
        Math.min(nodeLength, endOffset - nodeStart),
        `${path}.${index}`,
      ),
    );
  }

  return sliced;
}

function extractInlineNodeSlice(node: Inline, startOffset: number, endOffset: number): string {
  if (startOffset >= endOffset) {
    return "";
  }

  switch (node.type) {
    case "break":
      return "\n".slice(startOffset, endOffset);
    case "image":
      return INLINE_OBJECT_REPLACEMENT_TEXT.slice(startOffset, endOffset);
    case "inlineCode":
      return node.code.slice(startOffset, endOffset);
    case "link":
      return extractInlineSelectionText(node.children, startOffset, endOffset);
    case "text":
      return node.text.slice(startOffset, endOffset);
    case "unsupported":
      return node.raw.slice(startOffset, endOffset);
  }
}

function shouldRemoveInlineMark(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  mark: Mark,
) {
  let cursor = 0;
  let hasText = false;
  let allMarked = true;

  const visit = (candidates: Inline[]) => {
    for (const node of candidates) {
      const nodeLength = measureInlineNodeText(node);
      const nodeStart = cursor;
      const nodeEnd = nodeStart + nodeLength;
      cursor = nodeEnd;

      if (endOffset <= nodeStart || startOffset >= nodeEnd) {
        continue;
      }

      if (node.type === "text") {
        const overlapStart = Math.max(startOffset, nodeStart);
        const overlapEnd = Math.min(endOffset, nodeEnd);

        if (overlapEnd > overlapStart) {
          hasText = true;
          allMarked &&= node.marks.includes(mark);
        }
        continue;
      }

      if (node.type === "link") {
        const previousCursor = cursor;
        cursor = nodeStart;
        visit(node.children);
        cursor = previousCursor;
      }
    }
  };

  visit(nodes);

  return hasText ? allMarked : null;
}

function toggleInlineNodesMark(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  mark: Mark,
  shouldRemove: boolean,
  path: string,
): Inline[] {
  const nextNodes: Inline[] = [];
  let cursor = 0;

  for (const [index, node] of nodes.entries()) {
    const nodeStart = cursor;
    const nodeLength = measureInlineNodeText(node);
    const nodeEnd = nodeStart + nodeLength;
    const nodePath = `${path}.${index}`;

    cursor = nodeEnd;

    if (endOffset <= nodeStart || startOffset >= nodeEnd) {
      nextNodes.push(node);
      continue;
    }

    if (node.type === "text") {
      nextNodes.push(
        ...toggleTextNodeMark(
          node,
          Math.max(0, startOffset - nodeStart),
          Math.min(nodeLength, endOffset - nodeStart),
          mark,
          shouldRemove,
          nodePath,
        ),
      );
      continue;
    }

    if (node.type === "link") {
      const children = compactInlineNodes(
        toggleInlineNodesMark(
          node.children,
          Math.max(0, startOffset - nodeStart),
          Math.min(nodeLength, endOffset - nodeStart),
          mark,
          shouldRemove,
          `${nodePath}.children`,
        ),
      );

      if (children.length > 0) {
        nextNodes.push({
          ...node,
          children,
        });
      }
      continue;
    }

    nextNodes.push(node);
  }

  return nextNodes;
}

function toggleTextNodeMark(
  node: Text,
  startOffset: number,
  endOffset: number,
  mark: Mark,
  shouldRemove: boolean,
  path: string,
) {
  const beforeText = node.text.slice(0, startOffset);
  const selectedText = node.text.slice(startOffset, endOffset);
  const afterText = node.text.slice(endOffset);
  const selectedMarks = shouldRemove
    ? node.marks.filter((candidate) => candidate !== mark)
    : insertMark(node.marks, mark);

  return [
    createPathTextNode(beforeText, node.marks, `${path}.before`),
    createPathTextNode(selectedText, selectedMarks, `${path}.selected`),
    createPathTextNode(afterText, node.marks, `${path}.after`),
  ].filter(Boolean) as Text[];
}

function insertMark(marks: Mark[], mark: Mark) {
  return marks.includes(mark) ? marks : [...marks, mark].sort();
}

function createInlineCommandReplacement(
  target: InlineCommandTarget,
  nextChildren: Inline[],
  startOffset: number,
  endOffset: number,
): InlineCommandReplacement {
  switch (target.kind) {
    case "inlineBlock":
      return {
        block: rebuildTextBlock(target.block, nextChildren),
        blockId: target.block.id,
        selection: createRangeSelectionTarget(
          `${target.path}.children`,
          startOffset,
          endOffset,
        ),
      };
    case "tableCell": {
      const nextCell = createDocumentTableCell({
        children: nextChildren,
        path: target.path,
      });
      const nextRows = target.block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => (cell.id === target.cell.id ? nextCell : cell)),
      }));

      return {
        block: rebuildTableBlock(target.block, nextRows),
        blockId: target.block.id,
        selection: createRangeSelectionTarget(target.path, startOffset, endOffset),
      };
    }
  }
}

function createRangeSelectionTarget(
  path: string,
  startOffset: number,
  endOffset: number,
): RegionRangePathSelectionTarget {
  return {
    endOffset,
    kind: "region-range-path",
    path,
    startOffset,
  };
}

function replaceBlockById(
  documentEditor: DocumentEditor,
  block: Block,
  targetBlockId: string,
  container: DocumentEditorRegion,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): Block {
  if (block.id === targetBlockId) {
    return replaceBlockContainerText(
      documentEditor,
      block,
      container,
      startOffset,
      endOffset,
      replacementText,
    );
  }

  switch (block.type) {
    case "blockquote":
    case "listItem": {
      const nextChildren = block.children.map((child) =>
        replaceBlockById(
          documentEditor,
          child,
          targetBlockId,
          container,
          startOffset,
          endOffset,
          replacementText,
        ),
      );
      const nextPlainText = extractPlainTextFromBlockNodes(nextChildren);

      return {
        ...block,
        children: nextChildren,
        plainText: nextPlainText,
      };
    }
    case "list": {
      const nextChildren = block.children.map((child) =>
        replaceBlockById(
          documentEditor,
          child,
          targetBlockId,
          container,
          startOffset,
          endOffset,
          replacementText,
        ) as Extract<Block, { type: "listItem" }>,
      );

      return {
        ...block,
        children: nextChildren,
        plainText: nextChildren.map((child) => child.plainText).join("\n"),
      };
    }
    default:
      return block;
  }
}

function flattenInlineNodes(
  nodes: Inline[],
  link: RuntimeLinkAttributes | null = null,
): DocumentEditorTextRun[] {
  const runs: DocumentEditorTextRun[] = [];
  let position = 0;

  const pushRun = (run: Omit<DocumentEditorTextRun, "end" | "start">) => {
    const start = position;
    const end = start + run.text.length;

    runs.push({
      ...run,
      end,
      start,
    });
    position = end;
  };

  for (const node of nodes) {
    switch (node.type) {
      case "break":
        pushRun({
          id: node.id,
          image: null,
          inlineCode: false,
          kind: "break",
          link,
          marks: [],
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
          text: resolveImageRunText(node.alt),
        });
        break;
      case "inlineCode":
        pushRun({
          id: node.id,
          image: null,
          inlineCode: true,
          kind: "inlineCode",
          link,
          marks: [],
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
          text: node.text,
        });
        break;
      case "unsupported":
        pushRun({
          id: node.id,
          image: null,
          inlineCode: false,
          kind: "unsupported",
          link,
          marks: [],
          text: node.raw,
        });
        break;
    }
  }

  return runs;
}

function resolveSelectionOrder(documentEditor: DocumentEditor, point: CanvasSelectionPoint) {
  const regionIndex = documentEditor.regions.findIndex(
    (region) => region.id === point.regionId,
  );

  if (regionIndex === -1) {
    throw new Error(`Unknown canvas region: ${point.regionId}`);
  }

  return regionIndex * 1_000_000 + point.offset;
}

function createCollapsedSelection(regionId: string, offset: number): CanvasSelection {
  const point = { offset, regionId };

  return {
    anchor: point,
    focus: point,
  };
}

function resolveRegionOffset(text: string, offset: number | "end") {
  return offset === "end"
    ? text.length
    : Math.max(0, Math.min(offset, text.length));
}

function resolveDescendantBlock(rootBlock: Block, childIndices: number[]) {
  let current: Block | null = rootBlock;

  for (const childIndex of childIndices) {
    if (!current) {
      return null;
    }

    const children = resolveBlockChildren(current);

    if (!children) {
      return null;
    }

    current = children[childIndex] ?? null;
  }

  return current;
}

function resolvePrimaryRegion(
  documentEditor: DocumentEditor,
  block: Block,
): DocumentEditor["regions"][number] | null {
  const entry = documentEditor.blockIndex.get(block.id);

  if (!entry) {
    return null;
  }

  const regionId = entry.regionIds[0];

  if (regionId) {
    return documentEditor.regionIndex.get(regionId) ?? null;
  }

  const children = resolveBlockChildren(block);

  if (!children) {
    return null;
  }

  for (const child of children) {
    const region: DocumentEditor["regions"][number] | null = resolvePrimaryRegion(documentEditor, child);

    if (region) {
      return region;
    }
  }

  return null;
}

function resolveBlockChildren(block: Block) {
  switch (block.type) {
    case "blockquote":
    case "list":
    case "listItem":
      return block.children;
    default:
      return null;
  }
}

function replaceBlockContainerText(
  documentEditor: DocumentEditor,
  block: Block,
  container: DocumentEditorRegion,
  startOffset: number,
  endOffset: number,
  replacementText: string,
): Block {
  const blockEntry = documentEditor.blocks.find((entry) => entry.id === block.id);

  if (!blockEntry) {
    return block;
  }

  switch (block.type) {
    case "heading":
      return replaceInlineBlockText(block, startOffset, endOffset, replacementText, blockEntry.path);
    case "paragraph":
      return replaceInlineBlockText(block, startOffset, endOffset, replacementText, blockEntry.path);
    case "code":
      return rebuildCodeBlock(
        block,
        block.value.slice(0, startOffset) + replacementText + block.value.slice(endOffset),
      );
    case "table":
      return replaceTableCellText(
        block,
        container.path,
        startOffset,
        endOffset,
        replacementText,
        blockEntry.path,
      );
    case "unsupported": {
      const nextRaw =
        block.raw.slice(0, startOffset) + replacementText + block.raw.slice(endOffset);
      return rebuildRawBlock(block, nextRaw);
    }
    default:
      throw new Error(`Canvas text replacement is not supported for block type: ${block.type}`);
  }
}

function replaceTableCellText(
  block: Extract<Block, { type: "table" }>,
  containerPath: string,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  blockPath: string,
): Extract<Block, { type: "table" }> {
  const match = /\.rows\.(\d+)\.cells\.(\d+)$/.exec(containerPath);

  if (!match) {
    throw new Error(`Unable to resolve table cell path: ${containerPath}`);
  }

  const rowIndex = Number(match[1]);
  const cellIndex = Number(match[2]);
  const rows = block.rows.map((row, currentRowIndex) => {
    if (currentRowIndex !== rowIndex) {
      return row;
    }

    const cells = row.cells.map<TableCell>((cell, currentCellIndex) => {
      if (currentCellIndex !== cellIndex) {
        return cell;
      }

      const nextChildren = replaceInlineNodesText(
        cell.children,
        startOffset,
        endOffset,
        replacementText,
        `${blockPath}.rows.${rowIndex}.cells.${cellIndex}.children`,
      );

      return createDocumentTableCell({
        children: nextChildren,
        path: `${blockPath}.rows.${rowIndex}.cells.${cellIndex}`,
      });
    });

    return {
      ...row,
      cells,
    };
  });
  return rebuildTableBlock(block, rows);
}

function replaceInlineBlockText(
  block: Extract<Block, { type: "heading" | "paragraph" }>,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  blockPath: string,
): Extract<Block, { type: "heading" | "paragraph" }> {
  const nextChildren = replaceInlineNodesText(
    block.children,
    startOffset,
    endOffset,
    replacementText,
    `${blockPath}.children`,
  );

  return rebuildTextBlock(block, nextChildren);
}

function replaceInlineNodesText(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  replacementText: string,
  path: string,
): Inline[] {
  const context = {
    didInsert: false,
    generatedNodeCount: 0,
    replacementText,
  };

  const nextNodes = editInlineNodes(nodes, startOffset, endOffset, path, context);

  return compactInlineNodes(nextNodes);
}

function editInlineNodes(
  nodes: Inline[],
  startOffset: number,
  endOffset: number,
  path: string,
  context: {
    didInsert: boolean;
    generatedNodeCount: number;
    replacementText: string;
  },
): Inline[] {
  const nextNodes: Inline[] = [];
  let cursor = 0;

  for (const [index, node] of nodes.entries()) {
    const childPath = `${path}.${index}`;
    const nodeLength = measureInlineNodeText(node);
    const nodeStart = cursor;
    const nodeEnd = nodeStart + nodeLength;

    if (!context.didInsert && startOffset === endOffset && startOffset === nodeStart) {
      pushGeneratedTextNode(nextNodes, context, path);
    }

    if (endOffset <= nodeStart || startOffset >= nodeEnd) {
      nextNodes.push(node);
      cursor = nodeEnd;
      continue;
    }

    const localStart = Math.max(0, startOffset - nodeStart);
    const localEnd = Math.min(nodeLength, endOffset - nodeStart);
    const replacement =
      !context.didInsert && context.replacementText.length > 0 ? context.replacementText : "";
    const nextForNode = replaceInlineNode(node, localStart, localEnd, replacement, childPath, context);

    if (localStart !== localEnd || replacement.length > 0) {
      context.didInsert = true;
    }

    nextNodes.push(...nextForNode);
    cursor = nodeEnd;
  }

  if (!context.didInsert) {
    pushGeneratedTextNode(nextNodes, context, path);
  }

  return nextNodes;
}

function replaceInlineNode(
  node: Inline,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  path: string,
  context: {
    didInsert: boolean;
    generatedNodeCount: number;
    replacementText: string;
  },
): Inline[] {
  switch (node.type) {
    case "text":
      return replaceTextLikeNode(node, node.text, startOffset, endOffset, replacementText, path);
    case "inlineCode":
      return replaceTextLikeNode(node, node.code, startOffset, endOffset, replacementText, path);
    case "image":
      return replaceImageNode(node, startOffset, endOffset, replacementText, path);
    case "unsupported":
      return replaceUnsupportedInlineNode(node, startOffset, endOffset, replacementText, path);
    case "break":
      return replaceBreakNode(node, startOffset, endOffset, replacementText, path, context);
    case "link": {
      const children = editInlineNodes(
        node.children,
        startOffset,
        endOffset,
        `${path}.children`,
        context,
      );

      return children.length > 0 ? [{ ...node, children }] : [];
    }
  }
}

function replaceTextLikeNode(
  node: Text | Code,
  value: string,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  path: string,
): Inline[] {
  const nextValue = value.slice(0, startOffset) + replacementText + value.slice(endOffset);

  if (nextValue.length === 0) {
    return [];
  }

  if (node.type === "text") {
    return [
      createDocumentTextNode({
        marks: node.marks,
        path,
        text: nextValue,
      }),
    ];
  }

  return [
    createDocumentInlineCodeNode({
      code: nextValue,
      path,
    }),
  ];
}

function resolveImageRunText(alt: string | null) {
  void alt;

  return INLINE_OBJECT_REPLACEMENT_TEXT;
}

function replaceImageNode(
  node: Extract<Inline, { type: "image" }>,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  path: string,
): Inline[] {
  const imageLength = measureInlineNodeText(node);

  if (startOffset === 0 && endOffset === imageLength) {
    return replacementText.length > 0
      ? [createDocumentTextNode({
          path: `${path}.replace`,
          text: replacementText,
        })]
      : [];
  }

  return [node];
}

function replaceUnsupportedInlineNode(
  node: Raw,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  path: string,
): Inline[] {
  const nextRaw = node.raw.slice(0, startOffset) + replacementText + node.raw.slice(endOffset);

  if (nextRaw.length === 0) {
    return [];
  }

  return [
    createDocumentUnsupportedInlineNode({
      originalType: node.originalType,
      path,
      raw: nextRaw,
    }),
  ];
}

function replaceBreakNode(
  node: Extract<Inline, { type: "break" }>,
  startOffset: number,
  endOffset: number,
  replacementText: string,
  path: string,
  context: {
    didInsert: boolean;
    generatedNodeCount: number;
    replacementText: string;
  },
): Inline[] {
  const nextNodes: Inline[] = [];

  if (startOffset === endOffset && startOffset === 0 && replacementText.length > 0) {
    pushGeneratedTextNode(nextNodes, context, path);
    nextNodes.push(node);

    return nextNodes;
  }

  if (startOffset === endOffset && startOffset === 1) {
    nextNodes.push(node);

    if (replacementText.length > 0) {
      pushGeneratedTextNode(nextNodes, context, path);
    }

    return nextNodes;
  }

  if (replacementText.length > 0) {
    pushGeneratedTextNode(nextNodes, context, path);
  }

  return nextNodes;
}

function pushGeneratedTextNode(
  nodes: Inline[],
  context: {
    didInsert: boolean;
    generatedNodeCount: number;
    replacementText: string;
  },
  path: string,
) {
  if (context.replacementText.length === 0) {
    context.didInsert = true;
    return;
  }

  const index = context.generatedNodeCount;
  context.generatedNodeCount += 1;
  nodes.push(createDocumentTextNode({
    path: `${path}.insert.${index}`,
    text: context.replacementText,
  }));
  context.didInsert = true;
}

function createPathTextNode(text: string, marks: Mark[], path: string) {
  if (text.length === 0) {
    return null;
  }

  return createDocumentTextNode({
    marks,
    path,
    text,
  }) satisfies Text;
}

function createPathInlineCodeNode(code: string, path: string): Code {
  return createDocumentInlineCodeNode({
    code,
    path,
  });
}

function compactInlineNodes(nodes: Inline[]) {
  const compacted: Inline[] = [];

  for (const node of nodes) {
    const previous = compacted.at(-1);

    if (
      previous?.type === "text" &&
      node.type === "text" &&
      previous.marks.join(",") === node.marks.join(",")
    ) {
      compacted[compacted.length - 1] = createDocumentTextNode({
        marks: previous.marks,
        path: previous.id,
        text: previous.text + node.text,
      });
      continue;
    }

    compacted.push(node);
  }

  return compacted;
}

function measureInlineNodeText(node: Inline) {
  switch (node.type) {
    case "break":
      return 1;
    case "image":
      return INLINE_OBJECT_REPLACEMENT_TEXT.length;
    case "inlineCode":
      return node.code.length;
    case "link":
      return extractPlainTextFromInlineNodes(node.children).length;
    case "text":
      return node.text.length;
    case "unsupported":
      return node.raw.length;
  }
}
