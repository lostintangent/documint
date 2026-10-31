import type { Mark } from "@/document";
import type { EditorLayoutState, LayoutRect } from "@/editor/layout";
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

type LayoutInlineReference = NonNullable<
  EditorLayoutState["layout"]["lines"][number]["inlineReferences"]
>[number];

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

export type ImageSegment = SegmentPaintBase & { atom: "image"; image: { url: string } };
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
  const { left, right } = resolveLineSegmentBounds(input.line, input.textLeft, start, end);
  const marks = inline.node.type === "text" ? inline.node.marks : [];
  const inlineStyle = resolveInlineTextStyle(
    { baseFontSize: input.baseFontSize, font: input.line.font },
    marks,
  );
  const atom = resolveTextSegmentAtom(inline, marks);
  const link = Boolean(inline.link);
  const resource =
    inline.node.type === "resource"
      ? resolveResourceSegmentFrame(
          resolveResource(inline.node, input.resources.resourceRegistry),
          resolveInlineReferenceMetric(input.line, inline),
          left,
        )
      : null;
  const image = inline.node.type === "image" ? { url: inline.node.url } : null;
  const mentionName = inline.node.type === "mention" ? inline.node.name : null;
  const baseSegment: SegmentPaintBase = {
    atom,
    font: inlineStyle.font,
    left,
    right,
  };
  const baseline = input.textBaseline + inlineStyle.baselineShift;

  switch (atom) {
    case "image":
      return image ? { ...baseSegment, atom, image } : createTextRunSegment();
    case "mention":
      return mentionName
        ? {
            ...baseSegment,
            atom,
            mentionName,
            pill: resolveTextPillFrame(input.line, inlineStyle.font, left, right),
            textLeft: left + mentionHorizontalPadding,
          }
        : createTextRunSegment();
    case "resource":
      return resource
        ? {
            ...baseSegment,
            atom,
            pill: resolveTextPillFrame(input.line, inlineStyle.font, left, right),
            resource,
          }
        : createTextRunSegment();
    default:
      return createTextRunSegment();
  }

  function createTextRunSegment(): TextRunSegment {
    return {
      ...baseSegment,
      atom: atom === "inline-code" ? "inline-code" : "text",
      baseline,
      color:
        atom === "inline-code"
          ? input.theme.inlineCodeText
          : link
            ? input.theme.linkText
            : input.defaultTextColor,
      end,
      start,
      strikethrough: marks.includes("strikethrough"),
      text,
      underline: marks.includes("underline") || link,
    };
  }
}

function resolveResourceSegmentFrame(
  resource: ReturnType<typeof resolveResource>,
  inlineReference: LayoutInlineReference | null,
  left: number,
): ResourceSegmentFrame | null {
  if (!resource) {
    return null;
  }

  const iconSegmentWidth =
    inlineReference?.kind === "resource" ? inlineReference.iconSegmentWidth : 0;

  return {
    iconSegmentWidth,
    icon: resource.icon,
    isActive: resource.isActive,
    labelLeft: left + iconSegmentWidth + resourceHorizontalPadding,
    label: resource.label,
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

function resolveInlineReferenceMetric(
  line: EditorLayoutState["layout"]["lines"][number],
  inline: IndexedInline,
) {
  return (
    line.inlineReferences?.find(
      (reference) => reference.start === inline.start && reference.end === inline.end,
    ) ?? null
  );
}

function resolveTextSegmentAtom(inline: IndexedInline, marks: readonly Mark[]): TextSegmentAtom {
  switch (inline.node.type) {
    case "image":
      return "image";
    case "mention":
      return "mention";
    case "resource":
      return "resource";
    default:
      return marks.includes("code") ? "inline-code" : "text";
  }
}

const textPill = {
  textVerticalNudge: 1,
  verticalNudge: -1,
  verticalPadding: 3,
};
