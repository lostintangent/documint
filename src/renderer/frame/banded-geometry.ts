import type { LayoutRect } from "@/editor/layout";

export type BandedGeometryFrame = {
  bands: readonly LayoutRect[];
  borderRect?: LayoutRect;
  rect: LayoutRect;
};
