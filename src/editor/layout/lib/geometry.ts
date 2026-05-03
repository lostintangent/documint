// Owns the small rect/extent types every layout file reuses. Stays free of
// behavior so consumers can import without pulling in spacing or option
// policy.

export type LayoutBlockExtent = {
  bottom: number;
  top: number;
};

export type ContainerLineBounds = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};
