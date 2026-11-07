import type { DocumentResourceIcon } from "@/editor/resources";

export const resourceHorizontalPadding = 7;
const resourceIconSegmentHorizontalPadding = 5;
const resourceMinimumIconSegmentWidth = 22;
const resourceMinimumWidth = 30;
export const resourceVectorIconSize = 13;

export function measureInlineResourceWidth(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  label: string,
  iconSegmentWidth: number,
) {
  return Math.max(
    resourceMinimumWidth,
    context.measureText(label).width + iconSegmentWidth + resourceHorizontalPadding * 2,
  );
}

export function measureInlineResourceIconSegmentWidth(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  icon: DocumentResourceIcon | null,
) {
  if (!icon) {
    return 0;
  }

  const iconWidth =
    typeof icon === "string" ? context.measureText(icon).width : resourceVectorIconSize;

  return Math.max(
    resourceMinimumIconSegmentWidth,
    iconWidth + resourceIconSegmentHorizontalPadding * 2,
  );
}
