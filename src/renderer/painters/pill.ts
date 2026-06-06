// Shared immediate-mode drawing for text replacement pill backgrounds.

export function paintTextPillBackground(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
) {
  const resolvedRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.roundRect(left, top, width, height, resolvedRadius);
  context.fill();
}
