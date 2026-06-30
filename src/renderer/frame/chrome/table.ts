import type { DocumentLayout, LayoutRect } from "@/editor/layout";
import type { BlockFlashFrame } from "../../effects";
import type { BandedGeometryFrame } from "../banded-geometry";

const tableCellMinimumPaintWidth = 80;
const activeTableCellBandVerticalBleed = 2;

type PathBounds = { bottom: number; left: number; right: number; top: number };

export type TableCellChromeFrame = {
  isHeaderRow: boolean;
  rect: LayoutRect;
};

export type TableCellGeometryFrame = BandedGeometryFrame & { borderRect: LayoutRect };

export type ActiveTableCellGeometryFrame = TableCellGeometryFrame & {
  activeFlash: BlockFlashFrame | null;
};

export function resolveTableCellChromeFrame(
  containerBounds: PathBounds,
  {
    isHeaderRow,
    lineHeight,
  }: {
    isHeaderRow: boolean;
    lineHeight: number;
  },
): TableCellChromeFrame {
  return {
    isHeaderRow,
    rect: resolveTableCellPaintRect(containerBounds, lineHeight),
  };
}

export function resolveActiveTableCellGeometryFrame({
  activeFlash,
  activePath,
  endLineIndex,
  layout,
  pathBounds,
  startLineIndex,
}: {
  activeFlash: BlockFlashFrame | null;
  activePath: string;
  endLineIndex: number;
  layout: DocumentLayout;
  pathBounds: Map<string, PathBounds>;
  startLineIndex: number;
}): ActiveTableCellGeometryFrame | null {
  const geometry = resolveTableCellGeometryFrame({
    endLineIndex,
    layout,
    pathBounds,
    path: activePath,
    startLineIndex,
  });

  return geometry ? { ...geometry, activeFlash } : null;
}

export function resolveTableCellGeometryFrame({
  endLineIndex,
  layout,
  pathBounds,
  path,
  startLineIndex,
}: {
  endLineIndex: number;
  layout: DocumentLayout;
  pathBounds: Map<string, PathBounds>;
  path: string;
  startLineIndex: number;
}): TableCellGeometryFrame | null {
  const cellBounds = pathBounds.get(path) ?? null;
  const cellLineIndices = layout.pathLineIndices.get(path) ?? null;

  if (!cellBounds || !cellLineIndices || cellLineIndices.length === 0) {
    return null;
  }

  const firstCellLine = layout.lines[cellLineIndices[0]!] ?? null;

  if (!firstCellLine) {
    return null;
  }

  const borderRect = resolveTableCellPaintRect(cellBounds, firstCellLine.height);

  if (borderRect.width === 0) {
    return null;
  }

  const bands: LayoutRect[] = [];

  for (const lineIndex of cellLineIndices) {
    if (lineIndex < startLineIndex) {
      continue;
    }

    if (lineIndex >= endLineIndex) {
      break;
    }

    const line = layout.lines[lineIndex]!;
    bands.push({
      height: line.height,
      left: borderRect.left,
      top: line.top - activeTableCellBandVerticalBleed,
      width: borderRect.width,
    });
  }

  return bands.length === 0 ? null : { bands, borderRect, rect: borderRect };
}

export function resolveTableCellPaintRect(
  containerBounds: PathBounds,
  lineHeight: number,
): LayoutRect {
  return {
    height: Math.max(containerBounds.bottom - containerBounds.top, lineHeight),
    left: containerBounds.left,
    top: containerBounds.top,
    width: Math.max(containerBounds.right - containerBounds.left, tableCellMinimumPaintWidth),
  };
}
