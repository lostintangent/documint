// Owns exact measurement of the document-top metadata prefix. Metadata keeps
// its own row and cell geometry, then document layout composes the unchanged
// body beneath it.

import type { DocumentMetadata } from "@/document";
import type { DocumentResources } from "@/types";
import { metadataKeyPath, metadataValuePath } from "../../state";
import { resolveCheckboxRect } from "../lib/marker-metrics";
import type { DocumentLayoutOptions } from "../lib/options";
import type { LayoutCache } from "../state/cache";
import {
  resolveTableRowHeight,
  TABLE_CELL_PADDING_X,
  TABLE_CELL_PADDING_Y,
  TABLE_MIN_WIDTH,
} from "./table";
import type { LayoutLine, LayoutRect } from "./index";
import {
  measureTextContainerLines,
  measureTextLineBoundaries,
  resolveBlockTypography,
  type BlockTypography,
  type LayoutTextInput,
} from "./text";

const METADATA_KEY_COLUMN_MIN_WIDTH = 116;
const METADATA_KEY_COLUMN_RATIO = 0.3;
const METADATA_VALUE_COLUMN_MIN_WIDTH = 40;
const METADATA_HEADER_PADDING_Y = 4;

type PathBounds = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

type MetadataLayoutRow = {
  checkbox?: {
    checked: boolean;
    path: string;
    rect: LayoutRect;
  };
  keyRect: LayoutRect;
  valueRect: LayoutRect;
};

export type MetadataLayout = {
  bodyOffset: number;
  expanded: boolean;
  header: LayoutRect;
  lines: readonly LayoutLine[];
  pathBounds: ReadonlyMap<string, PathBounds>;
  rows: readonly MetadataLayoutRow[];
};

export function measureMetadataPrefix(
  metadata: DocumentMetadata | null,
  options: DocumentLayoutOptions,
  cache: LayoutCache,
  resources: DocumentResources,
): MetadataLayout | null {
  if (metadata === null || "raw" in metadata) {
    return null;
  }

  const left = options.paddingX;
  const width = Math.max(TABLE_MIN_WIDTH, options.width - left - options.paddingX);
  const headerHeight = options.lineHeight + METADATA_HEADER_PADDING_Y * 2;
  const headerRect: LayoutRect = {
    height: headerHeight,
    left,
    top: options.paddingY,
    width,
  };
  const measured = options.metadataExpanded
    ? measureStructuredMetadataRows({ cache, headerRect, metadata, options, resources })
    : null;

  return {
    bodyOffset:
      (measured?.bottom ?? headerRect.top + headerRect.height) - headerRect.top + options.blockGap,
    expanded: options.metadataExpanded,
    header: headerRect,
    lines: measured?.lines ?? [],
    pathBounds: measured?.pathBounds ?? new Map(),
    rows: measured?.rows ?? [],
  };
}

function measureStructuredMetadataRows({
  cache,
  headerRect,
  metadata,
  options,
  resources,
}: {
  cache: LayoutCache;
  headerRect: LayoutRect;
  metadata: ReadonlyMap<string, string | boolean>;
  options: DocumentLayoutOptions;
  resources: DocumentResources;
}) {
  const typography = resolveBlockTypography(null, options.fontSize, options.lineHeight);
  const keyColumnWidth = Math.min(
    headerRect.width - METADATA_VALUE_COLUMN_MIN_WIDTH,
    Math.max(METADATA_KEY_COLUMN_MIN_WIDTH, headerRect.width * METADATA_KEY_COLUMN_RATIO),
  );
  const valueColumnWidth = headerRect.width - keyColumnWidth;
  const keyContentWidth = Math.max(40, keyColumnWidth - TABLE_CELL_PADDING_X * 2);
  const valueContentWidth = Math.max(40, valueColumnWidth - TABLE_CELL_PADDING_X * 2);
  const lines: LayoutLine[] = [];
  const pathBounds = new Map<string, PathBounds>();
  const rows: MetadataLayoutRow[] = [];
  let top = headerRect.top + headerRect.height;
  let fieldIndex = 0;

  for (const [key, value] of metadata) {
    const keyPath = metadataKeyPath(fieldIndex);
    const valuePath = metadataValuePath(fieldIndex);
    const keyLines = measureMetadataTextLines({
      cache,
      cellLeft: headerRect.left,
      cellTop: top,
      path: keyPath,
      resources,
      text: key,
      typography,
      width: keyContentWidth,
    });
    const valueLines =
      typeof value === "string"
        ? measureMetadataTextLines({
            cache,
            cellLeft: headerRect.left + keyColumnWidth,
            cellTop: top,
            path: valuePath,
            resources,
            text: value,
            typography,
            width: valueContentWidth,
          })
        : [];
    const rowHeight = resolveTableRowHeight(options.lineHeight, [
      sumLineHeights(keyLines),
      valueLines.length > 0 ? sumLineHeights(valueLines) : options.lineHeight,
    ]);
    const keyCellRect = {
      height: rowHeight,
      left: headerRect.left,
      top,
      width: keyColumnWidth,
    };
    const valueCellRect = {
      height: rowHeight,
      left: headerRect.left + keyColumnWidth,
      top,
      width: valueColumnWidth,
    };

    lines.push(...keyLines, ...valueLines);

    const checkbox =
      typeof value === "boolean"
        ? {
            checked: value,
            path: valuePath,
            rect: resolveCheckboxRect({
              font: typography.font,
              height: typography.lineHeight,
              left: valueCellRect.left + TABLE_CELL_PADDING_X,
              top: valueCellRect.top + TABLE_CELL_PADDING_Y,
            }),
          }
        : undefined;

    pathBounds.set(keyPath, rectToPathBounds(keyCellRect));
    pathBounds.set(valuePath, rectToPathBounds(valueCellRect));
    rows.push({
      checkbox,
      keyRect: keyCellRect,
      valueRect: valueCellRect,
    });

    top += rowHeight;
    fieldIndex += 1;
  }

  return {
    bottom: top,
    lines,
    pathBounds,
    rows,
  };
}

function measureMetadataTextLines({
  cache,
  cellLeft,
  cellTop,
  path,
  resources,
  text,
  typography,
  width,
}: {
  cache: LayoutCache;
  cellLeft: number;
  cellTop: number;
  path: string;
  resources: DocumentResources;
  text: string;
  typography: BlockTypography;
  width: number;
}) {
  const input: LayoutTextInput = { kind: "preformatted", path, text };
  const measuredLines = measureTextContainerLines(cache, input, width, typography, resources);
  let top = cellTop + TABLE_CELL_PADDING_Y;

  return measuredLines.map((line): LayoutLine => {
    const layoutLine = {
      blockPath: null,
      boundaries: measureTextLineBoundaries(
        cache,
        input,
        line.start,
        line.end,
        line.text,
        width,
        typography,
        resources,
      ),
      contentInset: 0,
      end: line.end,
      font: typography.font,
      height: line.height,
      inlineReferences: null,
      left: cellLeft + TABLE_CELL_PADDING_X,
      path,
      start: line.start,
      text: line.text,
      top,
      width: line.width,
    } satisfies LayoutLine;
    top += line.height;
    return layoutLine;
  });
}

function rectToPathBounds(rect: LayoutRect): PathBounds {
  return {
    bottom: rect.top + rect.height,
    left: rect.left,
    right: rect.left + rect.width,
    top: rect.top,
  };
}

function sumLineHeights(lines: readonly { height: number }[]) {
  return lines.reduce((total, line) => total + line.height, 0);
}
