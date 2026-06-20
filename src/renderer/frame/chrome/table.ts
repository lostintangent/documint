import type { DocumentLayout, LayoutRect } from "@/editor/layout";
import type { BlockFlashFrame } from "../../effects";
import type { BandedGeometryFrame } from "../banded-geometry";

const tableCellMinimumPaintWidth = 80;
const activeTableCellBandVerticalBleed = 2;

type RegionBounds = { bottom: number; left: number; right: number; top: number };

export type TableCellChromeFrame = {
  isHeaderRow: boolean;
  rect: LayoutRect;
};

export type TableCellGeometryFrame = BandedGeometryFrame & { borderRect: LayoutRect };

export type ActiveTableCellGeometryFrame = TableCellGeometryFrame & {
  activeFlash: BlockFlashFrame | null;
};

export function resolveTableCellChromeFrame(
  containerBounds: RegionBounds,
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
  activeRegionId,
  endLineIndex,
  layout,
  regionBounds,
  startLineIndex,
}: {
  activeFlash: BlockFlashFrame | null;
  activeRegionId: string;
  endLineIndex: number;
  layout: DocumentLayout;
  regionBounds: Map<string, RegionBounds>;
  startLineIndex: number;
}): ActiveTableCellGeometryFrame | null {
  const geometry = resolveTableCellGeometryFrame({
    endLineIndex,
    layout,
    regionBounds,
    regionId: activeRegionId,
    startLineIndex,
  });

  return geometry ? { ...geometry, activeFlash } : null;
}

export function resolveTableCellGeometryFrame({
  endLineIndex,
  layout,
  regionBounds,
  regionId,
  startLineIndex,
}: {
  endLineIndex: number;
  layout: DocumentLayout;
  regionBounds: Map<string, RegionBounds>;
  regionId: string;
  startLineIndex: number;
}): TableCellGeometryFrame | null {
  const cellBounds = regionBounds.get(regionId) ?? null;
  const cellLineIndices = layout.regionLineIndices.get(regionId) ?? null;

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
  containerBounds: RegionBounds,
  lineHeight: number,
): LayoutRect {
  return {
    height: Math.max(containerBounds.bottom - containerBounds.top, lineHeight),
    left: containerBounds.left,
    top: containerBounds.top,
    width: Math.max(containerBounds.right - containerBounds.left, tableCellMinimumPaintWidth),
  };
}
