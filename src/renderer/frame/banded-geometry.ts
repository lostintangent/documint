import type { LayoutRect } from "@/editor/layout";

export type BandedGeometryFrame = {
  bands: readonly LayoutRect[];
  borderRect?: LayoutRect;
  rect: LayoutRect;
};

export function createRectBandedGeometryFrame(rect: LayoutRect): BandedGeometryFrame {
  return {
    bands: [rect],
    rect,
  };
}
