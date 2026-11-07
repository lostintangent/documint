import { resolveInlineImageBounds, type EditorLayoutState, type LayoutRect } from "@/editor/layout";
import type { IndexedInline } from "@/editor/state";
import { findInlinesInRange } from "@/editor/state";
import { resolveInlineTextStyle } from "@/editor/text/fonts";
import { resolveCenteredTextBaseline, resolveFontMetrics } from "@/editor/text/measure";
import {
  resolveResource,
  type DocumentResourceIcon,
  type DocumentResources,
} from "@/editor/resources";
import { mentionHorizontalPadding } from "@/editor/layout/measure/inline-mention";
import { resourceHorizontalPadding } from "@/editor/layout/measure/inline-resource";
import type { ResolvedEditorTheme } from "../../theme";
import { resolveLineSegmentBounds } from "./text-geometry";

type TextSegmentAtom = "image" | "inline-code" | "mention" | "resource" | "text";

type ResourceSegmentFrame = {
  iconSegmentWidth: number;
  icon: DocumentResourceIcon | null;
  isActive: boolean;
  labelLeft: number;
  label: string;
};

type TextPillFrame = {
  rect: LayoutRect;
  textBaseline: number;
};

type SegmentPaintBase = {
  atom: TextSegmentAtom;
  font: string;
  left: number;
  right: number;
};

export type TextRunSegment = SegmentPaintBase & {
  atom: "inline-code" | "text";
  baseline: number;
  color: string;
  end: number;
  start: number;
  text: string;
  underline: boolean;
  strikethrough: boolean;
};

export type ImageSegment = SegmentPaintBase & {
  atom: "image";
  image: { url: string };
  rect: LayoutRect;
};
export type MentionSegment = SegmentPaintBase & {
  atom: "mention";
  mentionName: string;
  pill: TextPillFrame;
  textLeft: number;
};
export type ResourceSegment = SegmentPaintBase & {
  atom: "resource";
  pill: TextPillFrame;
  resource: ResourceSegmentFrame;
};

export type TextSegment = TextRunSegment | ImageSegment | MentionSegment | ResourceSegment;

export function isTextRunSegment(segment: TextSegment): segment is TextRunSegment {
  return segment.atom === "inline-code" || segment.atom === "text";
}

type ResolveLineTextSegmentsInput = {
  baseFontSize: number;
  defaultTextColor: string;
  inlines: readonly IndexedInline[] | null;
  line: EditorLayoutState["layout"]["lines"][number];
  resources: DocumentResources;
  text: string | null;
  textBaseline: number;
  textLeft: number;
  theme: ResolvedEditorTheme;
};

export function resolveLineTextSegments(input: ResolveLineTextSegmentsInput): TextSegment[] {
  const { inlines, line, text } = input;
  const visibleInlines = text && inlines ? findInlinesInRange(inlines, line.start, line.end) : [];

  if (!text || visibleInlines.length === 0) {
    return [createPlainTextSegment(input)];
  }

  const segments: TextSegment[] = [];

  for (const inline of visibleInlines) {
    const start = Math.max(line.start, inline.start);
    const end = Math.min(line.end, inline.end);
    const segmentText = text.slice(start, end);

    if (segmentText.length === 0) {
      continue;
    }

    segments.push(createInlineTextSegment(input, inline, start, end, segmentText));
  }

  return segments;
}

function createPlainTextSegment(input: ResolveLineTextSegmentsInput): TextSegment {
  const { end, font, start, text } = input.line;
  const { left, right } = resolveLineSegmentBounds(input.line, input.textLeft, start, end);

  return {
    atom: "text",
    baseline: input.textBaseline,
    color: input.defaultTextColor,
    end,
    font,
    left,
    right,
    start,
    strikethrough: false,
    text,
    underline: false,
  };
}

function createInlineTextSegment(
  input: ResolveLineTextSegmentsInput,
  inline: IndexedInline,
  start: number,
  end: number,
  text: string,
): TextSegment {
  const { line, theme } = input;
  const { left, right } = resolveLineSegmentBounds(line, input.textLeft, start, end);
  const { node } = inline;
  const marks = node.type === "text" ? node.marks : [];
  const { baselineShift, font } = resolveInlineTextStyle(
    { baseFontSize: input.baseFontSize, font: line.font },
    marks,
  );

  // Atoms fall back to a text run when their content or resource is missing.
  switch (node.type) {
    case "image": {
      const reference = resolveInlineReference(line, inline);

      if (reference?.kind === "image") {
        const rect = resolveInlineImageBounds(line, reference);
        return { atom: "image", font, image: { url: node.url }, left, rect, right };
      }
      break;
    }
    case "mention":
      if (node.name) {
        return {
          atom: "mention",
          font,
          left,
          mentionName: node.name,
          pill: resolveTextPillFrame(line, font, left, right),
          right,
          textLeft: left + mentionHorizontalPadding,
        };
      }
      break;
    case "resource": {
      const resource = resolveResource(node, input.resources.resourceRegistry);

      if (resource) {
        const reference = resolveInlineReference(line, inline);
        const iconSegmentWidth = reference?.kind === "resource" ? reference.iconSegmentWidth : 0;

        return {
          atom: "resource",
          font,
          left,
          pill: resolveTextPillFrame(line, font, left, right),
          resource: {
            iconSegmentWidth,
            icon: resource.icon,
            isActive: resource.isActive,
            labelLeft: left + iconSegmentWidth + resourceHorizontalPadding,
            label: resource.label,
          },
          right,
        };
      }
      break;
    }
  }

  const code = marks.includes("code");
  const link = Boolean(inline.link);

  return {
    atom: code ? "inline-code" : "text",
    baseline: input.textBaseline + baselineShift,
    color: code ? theme.inlineCodeText : link ? theme.linkText : input.defaultTextColor,
    end,
    font,
    left,
    right,
    start,
    strikethrough: marks.includes("strikethrough"),
    text,
    underline: marks.includes("underline") || link,
  };
}

// Mention and resource pills wrap the font's ascent and descent around the
// line's centered baseline.
function resolveTextPillFrame(
  line: EditorLayoutState["layout"]["lines"][number],
  font: string,
  left: number,
  right: number,
): TextPillFrame {
  const baseline = line.top + resolveCenteredTextBaseline(line.height, font);
  const { ascent, descent } = resolveFontMetrics(font);

  return {
    rect: {
      height: ascent + descent + textPill.verticalPadding * 2,
      left,
      top: baseline - ascent - textPill.verticalPadding + textPill.verticalNudge,
      width: Math.max(0, right - left),
    },
    textBaseline: baseline + textPill.verticalNudge + textPill.textVerticalNudge,
  };
}

function resolveInlineReference(
  line: EditorLayoutState["layout"]["lines"][number],
  inline: IndexedInline,
) {
  return line.inlineReferences?.find(
    (reference) => reference.start === inline.start && reference.end === inline.end,
  );
}

const textPill = {
  textVerticalNudge: 1,
  verticalNudge: -1,
  verticalPadding: 3,
};
