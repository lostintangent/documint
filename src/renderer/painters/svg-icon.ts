import type { DocumentResourceIconNode } from "@/types";

export function paintSvgIconNode(
  context: CanvasRenderingContext2D,
  node: DocumentResourceIconNode,
  {
    centerX,
    centerY,
    size,
  }: {
    centerX: number;
    centerY: number;
    size: number;
  },
) {
  const scale = size / 24;

  context.save();
  context.translate(centerX - size / 2, centerY - size / 2);
  context.scale(scale, scale);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 2;

  for (const [elementName, attrs] of node) {
    paintSvgElement(context, elementName, attrs);
  }

  context.restore();
}

function paintSvgElement(
  context: CanvasRenderingContext2D,
  elementName: string,
  attrs: Readonly<Record<string, string>>,
) {
  switch (elementName) {
    case "circle":
      context.beginPath();
      context.arc(
        numberAttr(attrs, "cx"),
        numberAttr(attrs, "cy"),
        numberAttr(attrs, "r"),
        0,
        Math.PI * 2,
      );
      context.stroke();
      return;
    case "line":
      context.beginPath();
      context.moveTo(numberAttr(attrs, "x1"), numberAttr(attrs, "y1"));
      context.lineTo(numberAttr(attrs, "x2"), numberAttr(attrs, "y2"));
      context.stroke();
      return;
    case "path":
      paintPath(context, attrs.d ?? "");
      return;
    case "polygon":
      paintPolyline(context, attrs.points ?? "", true);
      return;
    case "polyline":
      paintPolyline(context, attrs.points ?? "", false);
      return;
    case "rect":
      paintRect(context, attrs);
      return;
  }
}

function paintPath(context: CanvasRenderingContext2D, data: string) {
  if (typeof Path2D === "undefined") {
    context.stroke();
    return;
  }

  context.stroke(new Path2D(data));
}

function paintPolyline(context: CanvasRenderingContext2D, points: string, closePath: boolean) {
  const pairs = points
    .trim()
    .split(/\s+/)
    .map((point) => point.split(",").map(Number))
    .filter(
      (point): point is [number, number] => point.length === 2 && point.every(Number.isFinite),
    );

  if (pairs.length === 0) {
    return;
  }

  context.beginPath();
  context.moveTo(pairs[0][0], pairs[0][1]);
  for (let index = 1; index < pairs.length; index += 1) {
    context.lineTo(pairs[index][0], pairs[index][1]);
  }
  if (closePath) {
    context.closePath();
  }
  context.stroke();
}

function paintRect(context: CanvasRenderingContext2D, attrs: Readonly<Record<string, string>>) {
  const x = numberAttr(attrs, "x");
  const y = numberAttr(attrs, "y");
  const width = numberAttr(attrs, "width");
  const height = numberAttr(attrs, "height");
  const radius = numberAttr(attrs, "rx") || numberAttr(attrs, "ry");

  context.beginPath();
  if (radius > 0) {
    context.roundRect(x, y, width, height, radius);
  } else {
    context.rect(x, y, width, height);
  }
  context.stroke();
}

function numberAttr(attrs: Readonly<Record<string, string>>, name: string) {
  const value = Number(attrs[name]);
  return Number.isFinite(value) ? value : 0;
}
