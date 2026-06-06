import type { Mark } from "@/document";
import type { EditorLayoutState } from "@/editor/layout";
import type { EditableRegion, IndexedInline } from "@/editor/state";
import { findInlinesInRange, regionInlines } from "@/editor/state";
import { resolveInlineTextStyle } from "@/editor/text/fonts";
import { resolveResource } from "@/editor/resources";
import { mentionHorizontalPadding } from "@/editor/layout/measure/inline-mention";
import { resourceHorizontalPadding } from "@/editor/layout/measure/inline-resource";
import type { DocumentResourceIcon, DocumentResources, ResolvedEditorTheme } from "@/types";
import { resolveLineSegmentBounds } from "./text-geometry";
import { resolveTextPillFrame, type TextPillFrame } from "./text-pill";

type TextSegmentAtom = "image" | "inline-code" | "mention" | "resource" | "text";

type ResourceSegmentFrame = {
  iconSegmentWidth: number;
  icon: DocumentResourceIcon | null;
  isActive: boolean;
  labelLeft: number;
  label: string;
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

type ResolveLineTextSegmentsInput = {
  baseFontSize: number;
  container: EditableRegion | null;
  defaultTextColor: string;
  line: EditorLayoutState["layout"]["lines"][number];
  resources: DocumentResources;
  textBaseline: number;
  textLeft: number;
  theme: ResolvedEditorTheme;
};

export function resolveLineTextSegments(input: ResolveLineTextSegmentsInput): TextSegment[] {
  const { container, line } = input;

  if (!container) {
    return [
      createPlainTextSegment({
        end: line.end,
        input,
        start: line.start,
        text: line.text,
      }),
    ];
  }

  const visibleInlines = findInlinesInRange(regionInlines(container), line.start, line.end);

  if (visibleInlines.length === 0) {
    return [
      createPlainTextSegment({
        end: line.end,
        input,
        start: line.start,
        text: line.text,
      }),
    ];
  }

  const segments: TextSegment[] = [];

  for (const inline of visibleInlines) {
    const start = Math.max(line.start, inline.start);
    const end = Math.min(line.end, inline.end);
    const text = container.text.slice(start, end);

    if (text.length === 0) {
      continue;
    }

    segments.push(createInlineTextSegment(input, inline, start, end, text));
  }

  return segments;
}

function createPlainTextSegment({
  end,
  input,
  start,
  text,
}: {
  end: number;
  input: ResolveLineTextSegmentsInput;
  start: number;
  text: string;
}): TextSegment {
  const { left, right } = resolveLineSegmentBounds(input.line, input.textLeft, start, end);

  return {
    atom: "text",
    baseline: input.textBaseline,
    color: input.defaultTextColor,
    end,
    font: input.line.font,
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
            pill: resolveTextPillFrame(input.line, inlineStyle.font, left, right, textPill),
            textLeft: left + mentionHorizontalPadding,
          }
        : createTextRunSegment();
    case "resource":
      return resource
        ? {
            ...baseSegment,
            atom,
            pill: resolveTextPillFrame(input.line, inlineStyle.font, left, right, textPill),
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
