// Owns editor-level text decoration indexing. Host/component code resolves
// semantic decoration matches elsewhere; this module reconciles those text
// ranges against the current editor document index so paint can read ranges by
// editor region path.

import { someVisibleDocumentLayoutLine, type EditorLayoutState } from "../layout";
import { resolveRegion, resolveRegionByPath, type EditorState } from "../state";

export type TextDecoration = {
  backgroundColor?: string;
  pulse?: boolean;
  color?: string;
  endOffset: number;
  path: string;
  startOffset: number;
};

export type TextDecorationIndex = ReadonlyMap<string, readonly TextDecoration[]>;

export type TextDecorationRootUpdate = {
  ranges: readonly TextDecoration[];
  rootIndex: number;
};

export function reconcileTextDecorationIndex(
  state: EditorState,
  previous: TextDecorationIndex,
  updates: readonly TextDecorationRootUpdate[],
): TextDecorationIndex | null {
  if (updates.length === 0) return previous.size === 0 ? null : new Map();

  const documentIndex = state.documentIndex;
  const currentRegionPaths = new Set(documentIndex.regions.map((region) => region.path));
  const next = new Map([...previous].filter(([path]) => currentRegionPaths.has(path)));
  let changed = next.size !== previous.size;

  for (const update of updates) {
    const rootRegionPaths = new Set(
      documentIndex.roots[update.rootIndex]?.regions.map((region) => region.path) ?? [],
    );
    for (const path of rootRegionPaths) {
      next.delete(path);
    }

    const grouped = groupDecorationsByPath(
      update.ranges.flatMap((range) => {
        const region = resolveRegionByPath(documentIndex, range.path);
        if (!region || region.rootIndex !== update.rootIndex) return [];
        return [
          {
            ...(range.backgroundColor && { backgroundColor: range.backgroundColor }),
            ...(range.color && { color: range.color }),
            ...(range.backgroundColor && range.pulse && { pulse: true }),
            endOffset: range.endOffset,
            path: range.path,
            startOffset: range.startOffset,
          },
        ];
      }),
    );

    for (const [path, ranges] of grouped) {
      next.set(path, ranges);
    }

    if (!sameRootDecorations(previous, next, rootRegionPaths)) {
      changed = true;
    }
  }

  return changed ? next : null;
}

function groupDecorationsByPath(decorations: TextDecoration[]): TextDecorationIndex {
  const grouped = new Map<string, TextDecoration[]>();

  for (const decoration of decorations) {
    const ranges = grouped.get(decoration.path);
    if (ranges) {
      ranges.push(decoration);
    } else {
      grouped.set(decoration.path, [decoration]);
    }
  }

  for (const ranges of grouped.values()) {
    ranges.sort((a, b) => a.startOffset - b.startOffset);
  }

  return grouped;
}

function sameRootDecorations(
  previous: TextDecorationIndex,
  next: TextDecorationIndex,
  paths: ReadonlySet<string>,
) {
  for (const path of paths) {
    if (!sameDecorations(previous.get(path) ?? [], next.get(path) ?? [])) {
      return false;
    }
  }

  return true;
}

function sameDecorations(
  a: readonly {
    backgroundColor?: string;
    pulse?: boolean;
    color?: string;
    endOffset: number;
    startOffset: number;
  }[],
  b: readonly {
    backgroundColor?: string;
    pulse?: boolean;
    color?: string;
    endOffset: number;
    startOffset: number;
  }[],
) {
  if (a.length !== b.length) return false;
  return a.every((decoration, index) => {
    const candidate = b[index]!;
    return (
      decoration.color === candidate.color &&
      decoration.backgroundColor === candidate.backgroundColor &&
      Boolean(decoration.backgroundColor && decoration.pulse) ===
        Boolean(candidate.backgroundColor && candidate.pulse) &&
      decoration.endOffset === candidate.endOffset &&
      decoration.startOffset === candidate.startOffset
    );
  });
}

export function hasAnimatedDecorations(index: TextDecorationIndex): boolean {
  for (const decorations of index.values()) {
    if (decorations.some((decoration) => decoration.backgroundColor && decoration.pulse)) {
      return true;
    }
  }

  return false;
}

export function hasAnimatedDecorationsInViewport(
  state: EditorState,
  viewport: EditorLayoutState,
  index: TextDecorationIndex,
): boolean {
  if (index.size === 0) {
    return false;
  }

  return someVisibleDocumentLayoutLine(viewport, (line) => {
    const regionPath = resolveRegion(state.documentIndex, line.regionId)?.path ?? null;
    const decorations = regionPath ? index.get(regionPath) : null;

    return decorations?.some((decoration) => isAnimatedDecorationOnLine(decoration, line)) ?? false;
  });
}

function isAnimatedDecorationOnLine(
  decoration: TextDecoration,
  line: EditorLayoutState["layout"]["lines"][number],
) {
  return (
    decoration.pulse === true &&
    Boolean(decoration.backgroundColor) &&
    decoration.endOffset > line.start &&
    decoration.startOffset < line.end
  );
}
