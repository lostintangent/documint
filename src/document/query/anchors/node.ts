import {
  blockPathSiblingIndex,
  getBlockChildren,
  parentBlockPath,
  type Block,
  type Document,
  type TableBlock,
  type TableCell,
  type TableRow,
} from "../../model";
import {
  estimateDocumentNodeContentHashCost,
  estimateTableCellContentHashCost,
  resolveBlockContentHash,
  resolveTableCellContentHash,
  resolveTableRowContentHash,
  type DocumentNodeContentHash,
} from "../content-hash";
import {
  createTableCellPathMatch,
  resolveBlockByPath,
  resolveTableCellPathMatch,
  type TableCellPathMatch,
} from "../paths";
import { visitDocument } from "../visit";

export type DocumentBlockAnchor = {
  readonly index: number;
  readonly kind: "block";
  readonly node: {
    readonly hash: DocumentNodeContentHash;
    readonly type: Block["type"];
  };
  readonly parent: {
    readonly kind: "block" | "document";
    readonly type?: Block["type"];
  };
  readonly path: string;
  readonly siblings: {
    readonly nextHash?: DocumentNodeContentHash;
    readonly previousHash?: DocumentNodeContentHash;
  };
};

export type DocumentTableCellAnchor = {
  readonly cells: {
    readonly nextHash?: DocumentNodeContentHash;
    readonly previousHash?: DocumentNodeContentHash;
  };
  readonly columnIndex: number;
  readonly kind: "table-cell";
  readonly node: {
    readonly hash: DocumentNodeContentHash;
  };
  readonly path: string;
  readonly rowIndex: number;
  readonly rows: {
    readonly nextHash?: DocumentNodeContentHash;
    readonly previousHash?: DocumentNodeContentHash;
  };
};

export type DocumentNodeAnchor = DocumentBlockAnchor | DocumentTableCellAnchor;

type DocumentNodeAnchorCandidate = {
  readonly anchor: DocumentNodeAnchor;
  readonly node: Block | TableCell;
  readonly path: string;
};

export type DocumentNodeAnchorResolution =
  | {
      readonly basis:
        | "exact-content"
        | "exact-content-context"
        | "exact-content-location";
      readonly anchor: DocumentNodeAnchor;
      readonly node: Block | TableCell;
      readonly path: string;
      readonly status: "matched";
    }
  | {
      readonly status: "absent";
    }
  | {
      readonly reason: "duplicate" | "weak-evidence";
      readonly status: "ambiguous";
    }
  | {
      readonly status: "exhausted";
    };

export type DocumentNodeAnchorResolveMode =
  | "contextual-content"
  | "exact-content";

export type DocumentNodeAnchorResolveOptions = {
  readonly maxVisitedNodes?: number;
  readonly mode?: DocumentNodeAnchorResolveMode;
};

const defaultMaxVisitedNodes = 800;

export function createDocumentNodeAnchor(
  document: Document,
  path: string,
): DocumentNodeAnchor | null {
  const block = resolveBlockByPath(document, path);
  if (block) {
    return createBlockAnchor(document, block, path);
  }

  const cellMatch = resolveTableCellPathMatch(document, path);
  return cellMatch
    ? createTableCellAnchor(cellMatch.cell, path, cellMatch)
    : null;
}

export function resolveDocumentNodeAnchor(
  document: Document,
  anchor: DocumentNodeAnchor,
  options: DocumentNodeAnchorResolveOptions = {},
): DocumentNodeAnchorResolution {
  return (
    resolveDocumentNodeAnchors(document, [anchor], options).get(
      documentNodeAnchorKey(anchor),
    ) ?? {
      status: "absent",
    }
  );
}

export function resolveDocumentNodeAnchors(
  document: Document,
  anchors: readonly DocumentNodeAnchor[],
  options: DocumentNodeAnchorResolveOptions = {},
): ReadonlyMap<string, DocumentNodeAnchorResolution> {
  const matches = new Map<string, DocumentNodeAnchorResolution>();
  const uniqueAnchors = new Map<string, DocumentNodeAnchor>();

  for (const anchor of anchors) {
    uniqueAnchors.set(documentNodeAnchorKey(anchor), anchor);
  }

  if (uniqueAnchors.size === 0) {
    return matches;
  }

  const collected = collectDocumentNodeAnchorCandidates(
    document,
    [...uniqueAnchors.values()],
    options,
  );

  if (collected.exhausted) {
    for (const key of uniqueAnchors.keys()) {
      matches.set(key, { status: "exhausted" });
    }
    return matches;
  }

  for (const [key, anchor] of uniqueAnchors) {
    const candidates =
      collected.candidates.get(documentNodeAnchorContentKey(anchor)) ?? [];
    matches.set(key, resolveAnchorFromCandidates(anchor, candidates, options));
  }

  return matches;
}

export function documentNodeAnchorKey(anchor: DocumentNodeAnchor) {
  if (anchor.kind === "block") {
    return [
      "block",
      anchor.node.type,
      anchor.node.hash,
      anchor.path,
      anchor.index,
      anchor.parent.kind,
      anchor.parent.type ?? "",
      anchor.siblings.previousHash ?? "",
      anchor.siblings.nextHash ?? "",
    ].join(":");
  }

  return [
    "table-cell",
    anchor.node.hash,
    anchor.path,
    anchor.rowIndex,
    anchor.columnIndex,
    anchor.cells.previousHash ?? "",
    anchor.cells.nextHash ?? "",
    anchor.rows.previousHash ?? "",
    anchor.rows.nextHash ?? "",
  ].join(":");
}

function createBlockAnchor(
  document: Document,
  block: Block,
  path: string,
): DocumentBlockAnchor {
  const siblingContext = resolveBlockSiblingContext(document, path);

  return {
    index: siblingContext.index,
    kind: "block",
    node: {
      hash: resolveBlockContentHash(block),
      type: block.type,
    },
    parent: {
      kind: siblingContext.parent?.type ? "block" : "document",
      type: siblingContext.parent?.type,
    },
    path,
    siblings: {
      nextHash: siblingContext.next
        ? resolveBlockContentHash(siblingContext.next)
        : undefined,
      previousHash: siblingContext.previous
        ? resolveBlockContentHash(siblingContext.previous)
        : undefined,
    },
  };
}

function createTableCellAnchor(
  cell: TableCell,
  path: string,
  context: TableCellPathMatch,
): DocumentTableCellAnchor {
  return {
    cells: {
      nextHash: context.nextCell
        ? resolveTableCellContentHash(context.nextCell)
        : undefined,
      previousHash: context.previousCell
        ? resolveTableCellContentHash(context.previousCell)
        : undefined,
    },
    columnIndex: context.cellIndex,
    kind: "table-cell",
    node: {
      hash: resolveTableCellContentHash(cell),
    },
    path,
    rowIndex: context.rowIndex,
    rows: {
      nextHash: context.nextRow
        ? resolveTableRowContentHash(context.nextRow)
        : undefined,
      previousHash: context.previousRow
        ? resolveTableRowContentHash(context.previousRow)
        : undefined,
    },
  };
}

function collectDocumentNodeAnchorCandidates(
  document: Document,
  anchors: readonly DocumentNodeAnchor[],
  options: DocumentNodeAnchorResolveOptions,
) {
  const pendingContentKeys = new Set(anchors.map(documentNodeAnchorContentKey));
  const pendingBlockTypes = new Set<Block["type"]>();
  let hasPendingTableCells = false;

  for (const anchor of anchors) {
    if (anchor.kind === "block") {
      pendingBlockTypes.add(anchor.node.type);
    } else {
      hasPendingTableCells = true;
    }
  }

  const candidates = new Map<string, DocumentNodeAnchorCandidate[]>();
  const maxVisitedNodes = options.maxVisitedNodes ?? defaultMaxVisitedNodes;
  let exhausted = false;
  let visitedNodes = 0;

  const addCost = (cost: number) => {
    visitedNodes += cost;
    if (visitedNodes > maxVisitedNodes) {
      exhausted = true;
      return true;
    }
    return false;
  };

  visitDocument(document, {
    enterBlock(block, { path }) {
      if (exhausted || pendingContentKeys.size === 0) {
        return exhausted ? "stop" : undefined;
      }

      if (!pendingBlockTypes.has(block.type)) {
        return;
      }

      if (addCost(estimateDocumentNodeContentHashCost(block))) {
        return "stop";
      }

      const key = blockAnchorContentKey(block);
      if (pendingContentKeys.has(key)) {
        const anchor = createBlockAnchor(document, block, path);
        appendCandidate(candidates, key, { anchor, node: block, path });
      }
    },
    enterInlineContainer() {
      return "skip";
    },
    enterTableCell(cell, context) {
      if (exhausted || pendingContentKeys.size === 0) {
        return exhausted ? "stop" : undefined;
      }

      if (!hasPendingTableCells) {
        return;
      }

      if (addCost(estimateTableCellContentHashCost(cell))) {
        return "stop";
      }

      const key = tableCellAnchorContentKey(cell);
      if (pendingContentKeys.has(key)) {
        const pathMatch = tableCellPathMatchFromVisitContext(cell, context);
        const anchor = createTableCellAnchor(cell, context.path, pathMatch);
        appendCandidate(candidates, key, {
          anchor,
          node: cell,
          path: context.path,
        });
      }
    },
  });

  return { candidates, exhausted };
}

function resolveAnchorFromCandidates(
  anchor: DocumentNodeAnchor,
  candidates: readonly DocumentNodeAnchorCandidate[],
  options: DocumentNodeAnchorResolveOptions,
): DocumentNodeAnchorResolution {
  if (candidates.length === 0) {
    return { status: "absent" };
  }

  if (candidates.length === 1) {
    const candidate = candidates[0]!;
    return resolveSingleAnchorCandidate(anchor, candidate);
  }

  if ((options.mode ?? "contextual-content") === "exact-content") {
    return {
      reason: "duplicate",
      status: "ambiguous",
    };
  }

  const contextualMatch =
    anchor.kind === "block"
      ? resolveBlockAnchorContext(anchor, candidates)
      : resolveTableCellAnchorContext(anchor, candidates);

  return (
    contextualMatch ?? {
      reason: "weak-evidence",
      status: "ambiguous",
    }
  );
}

function resolveSingleAnchorCandidate(
  anchor: DocumentNodeAnchor,
  candidate: DocumentNodeAnchorCandidate,
): DocumentNodeAnchorResolution {
  if (!anchorRequiresContextualMatch(anchor) || candidate.path === anchor.path) {
    return createMatchedAnchorResolution(
      anchor,
      candidate,
      candidate.path === anchor.path ? "exact-content-location" : "exact-content",
    );
  }

  const trustedContextMatch =
    anchor.kind === "block"
      ? candidate.anchor.kind === "block" && matchesBlockSiblingContext(anchor, candidate.anchor)
      : candidate.anchor.kind === "table-cell" &&
        hasTableCellContextMatch(anchor, candidate.anchor);

  return trustedContextMatch
    ? createMatchedAnchorResolution(
        anchor,
        candidate,
        resolveContextualMatchBasis(anchor, candidate),
      )
    : {
        reason: "weak-evidence",
        status: "ambiguous",
      };
}

function anchorRequiresContextualMatch(anchor: DocumentNodeAnchor) {
  if (anchor.kind === "block") {
    return (
      anchor.siblings.previousHash !== undefined ||
      anchor.siblings.nextHash !== undefined
    );
  }

  return (
    anchor.cells.previousHash !== undefined ||
    anchor.cells.nextHash !== undefined ||
    anchor.rows.previousHash !== undefined ||
    anchor.rows.nextHash !== undefined
  );
}

function resolveBlockAnchorContext(
  anchor: DocumentBlockAnchor,
  candidates: readonly DocumentNodeAnchorCandidate[],
): DocumentNodeAnchorResolution | null {
  return (
    resolveUniqueContextualCandidate(anchor, candidates, (candidate) => {
      if (candidate.anchor.kind !== "block") {
        return false;
      }

      return matchesBlockSiblingContext(anchor, candidate.anchor);
    }) ?? null
  );
}

function resolveTableCellAnchorContext(
  anchor: DocumentTableCellAnchor,
  candidates: readonly DocumentNodeAnchorCandidate[],
): DocumentNodeAnchorResolution | null {
  const cellContextMatches = candidates.filter((candidate) => {
    return (
      candidate.anchor.kind === "table-cell" &&
      matchesTableCellNeighborContext(anchor, candidate.anchor)
    );
  });
  const rowContextMatches = candidates.filter((candidate) => {
    return (
      candidate.anchor.kind === "table-cell" &&
      matchesTableCellRowContext(anchor, candidate.anchor)
    );
  });
  const matched = selectTableCellContextCandidate(
    cellContextMatches,
    rowContextMatches,
  );

  return matched
    ? createMatchedAnchorResolution(
        anchor,
        matched,
        resolveContextualMatchBasis(anchor, matched),
      )
    : null;
}

function matchesBlockSiblingContext(
  anchor: DocumentBlockAnchor,
  candidateAnchor: DocumentBlockAnchor,
) {
  return (
    hasMatchingHash(anchor.siblings.previousHash, candidateAnchor.siblings.previousHash) ||
    hasMatchingHash(anchor.siblings.nextHash, candidateAnchor.siblings.nextHash)
  );
}

function matchesTableCellNeighborContext(
  anchor: DocumentTableCellAnchor,
  candidateAnchor: DocumentTableCellAnchor,
) {
  return (
    hasMatchingHash(anchor.cells.previousHash, candidateAnchor.cells.previousHash) ||
    hasMatchingHash(anchor.cells.nextHash, candidateAnchor.cells.nextHash)
  );
}

function matchesTableCellRowContext(
  anchor: DocumentTableCellAnchor,
  candidateAnchor: DocumentTableCellAnchor,
) {
  return (
    hasMatchingHash(anchor.rows.previousHash, candidateAnchor.rows.previousHash) ||
    hasMatchingHash(anchor.rows.nextHash, candidateAnchor.rows.nextHash)
  );
}

function hasTableCellContextMatch(
  anchor: DocumentTableCellAnchor,
  candidateAnchor: DocumentTableCellAnchor,
) {
  return (
    matchesTableCellNeighborContext(anchor, candidateAnchor) ||
    matchesTableCellRowContext(anchor, candidateAnchor)
  );
}

function selectTableCellContextCandidate<T>(
  cellContextMatches: readonly T[],
  rowContextMatches: readonly T[],
): T | null {
  if (cellContextMatches.length > 0 && rowContextMatches.length > 0) {
    const rowContextSet = new Set(rowContextMatches);
    const intersection = cellContextMatches.filter((candidate) => rowContextSet.has(candidate));

    return selectOnlyCandidate(intersection);
  }

  const matches = cellContextMatches.length > 0 ? cellContextMatches : rowContextMatches;

  return selectOnlyCandidate(matches);
}

function selectOnlyCandidate<T>(candidates: readonly T[]): T | null {
  return candidates.length === 1 ? candidates[0]! : null;
}

function resolveUniqueContextualCandidate(
  anchor: DocumentNodeAnchor,
  candidates: readonly DocumentNodeAnchorCandidate[],
  matches: (candidate: DocumentNodeAnchorCandidate) => boolean,
): DocumentNodeAnchorResolution | null {
  let matched: DocumentNodeAnchorCandidate | null = null;

  for (const candidate of candidates) {
    if (!matches(candidate)) {
      continue;
    }

    if (matched) {
      return null;
    }

    matched = candidate;
  }

  if (!matched) {
    return null;
  }

  return createMatchedAnchorResolution(
    anchor,
    matched,
    resolveContextualMatchBasis(anchor, matched),
  );
}

function createMatchedAnchorResolution(
  anchor: DocumentNodeAnchor,
  candidate: DocumentNodeAnchorCandidate,
  basis: Extract<DocumentNodeAnchorResolution, { status: "matched" }>["basis"],
): DocumentNodeAnchorResolution {
  return {
    anchor: candidate.anchor,
    basis,
    node: candidate.node,
    path: candidate.path,
    status: "matched",
  };
}

function resolveContextualMatchBasis(
  anchor: DocumentNodeAnchor,
  candidate: DocumentNodeAnchorCandidate,
) {
  return candidate.path === anchor.path
    ? "exact-content-location"
    : "exact-content-context";
}

function documentNodeAnchorContentKey(anchor: DocumentNodeAnchor) {
  return anchor.kind === "block"
    ? `block:${anchor.node.type}:${anchor.node.hash}`
    : `table-cell:${anchor.node.hash}`;
}

function blockAnchorContentKey(block: Block) {
  return `block:${block.type}:${resolveBlockContentHash(block)}`;
}

function tableCellAnchorContentKey(cell: TableCell) {
  return `table-cell:${resolveTableCellContentHash(cell)}`;
}

function appendCandidate(
  candidates: Map<string, DocumentNodeAnchorCandidate[]>,
  key: string,
  candidate: DocumentNodeAnchorCandidate,
) {
  const existing = candidates.get(key);

  if (existing) {
    existing.push(candidate);
  } else {
    candidates.set(key, [candidate]);
  }
}

function hasMatchingHash<T>(left: T | undefined, right: T | undefined) {
  return left !== undefined && right !== undefined && left === right;
}

function resolveBlockSiblingContext(document: Document, path: string) {
  const siblingIndex = blockPathSiblingIndex(path);
  const parentPath = parentBlockPath(path);
  const parent = parentPath ? resolveBlockByPath(document, parentPath) : null;
  if (siblingIndex === null) {
    return {
      index: -1,
      next: null,
      parent,
      previous: null,
    };
  }

  const siblings = parent ? (getBlockChildren(parent) ?? []) : document.blocks;

  return {
    index: siblingIndex,
    next: siblings[siblingIndex + 1] ?? null,
    parent,
    previous: siblings[siblingIndex - 1] ?? null,
  };
}

function tableCellPathMatchFromVisitContext(
  cell: TableCell,
  context: {
    cellIndex: number;
    row: TableRow;
    rowIndex: number;
    table: TableBlock;
  },
): TableCellPathMatch {
  return createTableCellPathMatch(
    context.table,
    context.row,
    cell,
    context.rowIndex,
    context.cellIndex,
  );
}
