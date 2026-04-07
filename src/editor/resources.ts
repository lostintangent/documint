// Host-provided document resources such as loaded images. The editor consumes
// these for layout sizing and paint, while the host owns browser loading state.
export type DocumentImageResource = {
  intrinsicHeight: number;
  intrinsicWidth: number;
  source: CanvasImageSource | null;
  status: "error" | "loaded" | "loading";
};

export type DocumentResources = {
  images: Map<string, DocumentImageResource>;
};

export const emptyDocumentResources: DocumentResources = {
  images: new Map(),
};
