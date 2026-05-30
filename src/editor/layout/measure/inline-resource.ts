import type { ResolvedResource } from "@/editor/resources";
import type { DocumentResourceIcon } from "@/types";

export const resourceHorizontalPadding = 7;
export const resourceIconSegmentHorizontalPadding = 5;
export const resourceMinimumIconSegmentWidth = 22;
export const resourceMinimumWidth = 30;
export const resourceVectorIconSize = 13;

export function measureInlineResourceWidth(
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  resource: ResolvedResource,
) {
  const iconSegmentWidth = measureInlineResourceIconSegmentWidth(context, resource.icon);
  return Math.max(
    resourceMinimumWidth,
    context.measureText(resource.label).width + iconSegmentWidth + resourceHorizontalPadding * 2,
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
