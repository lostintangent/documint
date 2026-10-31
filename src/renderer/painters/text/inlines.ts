// Owns per-line text segment rendering. Replacement segments go to their
// dedicated painters; code segments paint a code background plus monospace
// glyphs; everything else paints as styled text with strikethrough/underline.

import type { DocumentLayout } from "@/editor/layout";
import type { DocumentFrameLine } from "@/renderer/frame";
import type { TextRunSegment } from "@/renderer/frame/line/text-segments";
import type { DocumentResources } from "@/editor/resources";
import type { ResolvedEditorTheme } from "../../theme";
import { paintImageSegment } from "../image";
import { paintMentionSegment } from "../mention";
import { paintResourceSegment } from "../resource";
import {
  paintTextBackground,
  resolveStrikethroughTop,
  resolveUnderlineTop,
  textDecorationMinimumWidth,
  textDecorationThickness,
} from "./glyphs";

export function paintLineText(
  lineFrame: DocumentFrameLine,
  environment: {
    clocks: { ambientTime: number };
    context: CanvasRenderingContext2D;
    resources: DocumentResources;
    theme: ResolvedEditorTheme;
  },
) {
  const { clocks, context, theme } = environment;

  for (const segment of lineFrame.segments) {
    context.font = segment.font;

    if (segment.atom === "image") {
      paintImageSegment(context, lineFrame, segment, environment);
      continue;
    }

    if (segment.atom === "mention") {
      paintMentionSegment(context, segment, theme);
      continue;
    }

    if (segment.atom === "resource") {
      paintResourceSegment(context, segment, clocks, theme);
      continue;
    }

    if (segment.atom === "inline-code") {
      paintTextBackground(
        context,
        segment.left,
        segment.right,
        segment.baseline,
        theme.inlineCodeBackground,
      );
    }

    paintTextRunSegment(context, lineFrame.layoutLine, segment);
  }
}

function paintTextRunSegment(
  context: CanvasRenderingContext2D,
  line: DocumentLayout["lines"][number],
  segment: TextRunSegment,
) {
  if (segment.text.length === 0) {
    return;
  }

  context.fillStyle = segment.color;
  context.fillText(segment.text, segment.left, segment.baseline);

  if (segment.strikethrough) {
    context.fillRect(
      segment.left,
      resolveStrikethroughTop(segment.baseline, line.height, context.font),
      Math.max(textDecorationMinimumWidth, segment.right - segment.left),
      textDecorationThickness,
    );
  }

  if (segment.underline) {
    context.fillRect(
      segment.left,
      resolveUnderlineTop(segment.baseline, line.height, context.font),
      Math.max(textDecorationMinimumWidth, segment.right - segment.left),
      textDecorationThickness,
    );
  }
}
