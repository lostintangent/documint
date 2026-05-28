// Owns paint policy for semantic references resolved against host-declared
// resource metadata. Markdown persists references as ordinary links, but
// parsing upgrades registered protocols before layout and rendering see them.

import type { DocumentLayout } from "@/editor/layout";
import type { InlineEntry } from "@/editor/state";
import { resolveInlineResource } from "@/editor/resources";
import {
  measureInlineResourceIconSegmentWidth,
  resourceHorizontalPadding,
  resourceVectorIconSize,
} from "@/editor/layout/measure/inline-resource";
import type { DocumentResourceIcon, DocumentResources, ResolvedEditorTheme } from "@/types";
import { blendCanvasColors } from "../animations/colors";
import { resolveRestingPulseAlpha } from "../animations/pulse";
import { paintSvgIconNode } from "./svg-icon";
import { resolveInlinePillBox } from "./pill";

const resourceCornerRadius = 6;
const resourceVerticalNudge = -1;
const resourceVerticalPadding = 3;
const resourceTextVerticalNudge = 1;

export function paintInlineResource(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  inline: InlineEntry,
  resources: DocumentResources,
  theme: ResolvedEditorTheme,
  left: number,
  right: number,
  ambientAnimationTime: number,
) {
  const resource = resolveInlineResource(inline, resources.resourceRegistry);

  if (!resource) {
    return;
  }

  const box = resolveInlinePillBox(context, line, left, right, {
    textVerticalNudge: resourceTextVerticalNudge,
    verticalNudge: resourceVerticalNudge,
    verticalPadding: resourceVerticalPadding,
  });
  const colors = resolveResourceColors(resource.isActive, theme, ambientAnimationTime);
  const iconSegmentWidth = measureInlineResourceIconSegmentWidth(context, resource.icon);

  context.save();
  context.beginPath();
  context.roundRect(left, box.top, box.width, box.height, resourceCornerRadius);
  context.clip();
  if (resource.icon) {
    context.fillStyle = colors.iconBackground;
    context.fillRect(left, box.top, iconSegmentWidth, box.height);
  }
  context.fillStyle = colors.labelBackground;
  context.fillRect(left + iconSegmentWidth, box.top, box.width - iconSegmentWidth, box.height);
  context.restore();

  if (resource.icon) {
    paintResourceIcon(context, resource.icon, theme.background, {
      baseline: box.textBaseline,
      centerX: left + iconSegmentWidth / 2,
      centerY: box.top + box.height / 2,
    });
  }

  context.fillStyle = colors.text;
  context.fillText(
    resource.label,
    left + iconSegmentWidth + resourceHorizontalPadding,
    box.textBaseline,
  );
}

function resolveResourceColors(
  isActive: boolean,
  theme: ResolvedEditorTheme,
  ambientAnimationTime: number,
) {
  if (!isActive) {
    return {
      iconBackground: theme.text,
      labelBackground: theme.commentHighlight,
      text: theme.leafSecondaryText,
    };
  }

  const pulseAlpha = resolveRestingPulseAlpha(ambientAnimationTime, 0.58);

  return {
    iconBackground: blendCanvasColors(theme.text, theme.commentHighlight, pulseAlpha),
    labelBackground: theme.commentHighlight,
    text: theme.text,
  };
}

function paintResourceIcon(
  context: CanvasRenderingContext2D,
  icon: DocumentResourceIcon,
  color: string,
  {
    baseline,
    centerX,
    centerY,
  }: {
    baseline: number;
    centerX: number;
    centerY: number;
  },
) {
  context.fillStyle = color;
  context.strokeStyle = color;

  if (typeof icon === "string") {
    const metrics = context.measureText(icon);
    context.fillText(icon, centerX - metrics.width / 2, baseline);
    return;
  }

  paintSvgIconNode(context, icon.node, {
    centerX,
    centerY,
    size: resourceVectorIconSize,
  });
}
