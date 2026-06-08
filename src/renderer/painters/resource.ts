// Owns paint policy for semantic references resolved against host-declared
// resource metadata. Markdown persists references as ordinary links, but
// parsing upgrades registered protocols before layout and rendering see them.

import { resourceVectorIconSize } from "@/editor/layout/measure/inline-resource";
import type { DocumentResourceIcon, ResolvedEditorTheme } from "@/types";
import type { ResourceSegment } from "../frame/line/text-segments";
import { blendCanvasColors } from "../effects/colors";
import { resolveRestingPulseAlpha } from "../effects/pulse";
import { paintSvgIconNode } from "./svg-icon";

const resourceCornerRadius = 6;

export function paintResourceSegment(
  context: CanvasRenderingContext2D,
  segment: ResourceSegment,
  clocks: { ambientTime: number },
  theme: ResolvedEditorTheme,
) {
  const { resource } = segment;
  const { pill } = segment;
  const colors = resolveResourceColors(resource.isActive, theme, clocks.ambientTime);

  context.save();
  context.beginPath();
  context.roundRect(
    pill.rect.left,
    pill.rect.top,
    pill.rect.width,
    pill.rect.height,
    resourceCornerRadius,
  );
  context.clip();
  if (resource.icon) {
    context.fillStyle = colors.iconBackground;
    context.fillRect(pill.rect.left, pill.rect.top, resource.iconSegmentWidth, pill.rect.height);
  }
  context.fillStyle = colors.labelBackground;
  context.fillRect(
    pill.rect.left + resource.iconSegmentWidth,
    pill.rect.top,
    pill.rect.width - resource.iconSegmentWidth,
    pill.rect.height,
  );
  context.restore();

  if (resource.icon) {
    paintResourceIcon(context, resource.icon, theme.background, {
      baseline: pill.textBaseline,
      centerX: pill.rect.left + resource.iconSegmentWidth / 2,
      centerY: pill.rect.top + pill.rect.height / 2,
    });
  }

  context.fillStyle = colors.text;
  context.fillText(resource.label, resource.labelLeft, pill.textBaseline);
}

function resolveResourceColors(
  isActive: boolean,
  theme: ResolvedEditorTheme,
  ambientTime: number,
) {
  if (!isActive) {
    return {
      iconBackground: theme.text,
      labelBackground: theme.commentHighlight,
      text: theme.leafSecondaryText,
    };
  }

  const pulseAlpha = resolveRestingPulseAlpha(ambientTime, 0.58);

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
    context.textAlign = "center";
    context.fillText(icon, centerX, baseline);
    context.textAlign = "start";
    return;
  }

  paintSvgIconNode(context, icon.node, {
    centerX,
    centerY,
    size: resourceVectorIconSize,
  });
}
