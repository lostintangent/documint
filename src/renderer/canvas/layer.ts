import type { PaintLayerFrame } from "../frame";

export function withPaintLayer(
  context: CanvasRenderingContext2D,
  layer: PaintLayerFrame,
  paint: () => void,
  background?: string,
) {
  context.save();
  context.scale(layer.devicePixelRatio, layer.devicePixelRatio);
  context.clearRect(0, 0, layer.width, layer.height);

  if (background !== undefined) {
    context.fillStyle = background;
    context.fillRect(0, 0, layer.width, layer.height);
  }

  context.textBaseline = "alphabetic";
  context.translate(0, -layer.paintTop);
  paint();
  context.restore();
}
