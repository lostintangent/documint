type EditorNodeViews = Record<string, never>;

export function createEditorNodeViews(): EditorNodeViews {
  return {};
}

export function formatCodeBlockSummary(
  language: string | null | undefined,
  meta: string | null | undefined,
) {
  const parts = [language || "plain text", meta].filter((part): part is string => Boolean(part));

  return `Code fence${parts.length > 0 ? ` • ${parts.join(" • ")}` : ""}`;
}

export function getCodeBlockLineCount(value: string) {
  return value.length === 0 ? 1 : value.split("\n").length;
}

export function formatImageSummary(
  url: string,
  title: string | null | undefined,
) {
  return [url, title ? `"${title}"` : ""].filter((part) => part.length > 0).join(" • ");
}

export function formatTableSummary(rowCount: number, columnCount: number, alignedColumns: number) {
  return `GFM table • ${rowCount} rows • ${columnCount} columns${
    alignedColumns > 0 ? ` • ${alignedColumns} aligned` : ""
  }`;
}

export function formatImageLabel(alt: string | null | undefined) {
  return alt || "Image";
}
