// Shared layout measurement policy for document reference inlines. Each
// reference still owns its own visual semantics, but text layout can consume
// one normalized measurement shape instead of branching on every reference
// kind in every measurement phase.

import type { RichInlineItem } from "@chenglou/pretext/rich-inline";
import type { DocumentResources } from "@/types";
import { createResourceIconSignature, resolveInlineResource } from "@/editor/resources";
import { indexedInlineText, inlineMarks, type IndexedInline } from "../../state";
import { resolveInlineTextStyle } from "../../text/fonts";
import { resolveInlineImageDimensions, resolveInlineImageSignature } from "./inline-image";
import { measureInlineMentionWidth, mentionHorizontalPadding } from "./inline-mention";
import {
  measureInlineResourceIconSegmentWidth,
  measureInlineResourceWidth,
  resourceHorizontalPadding,
} from "./inline-resource";
import type { BlockTypography } from "./text";

export type InlineReferenceMeasurement = {
  height: number;
  inlineReference: InlineReferenceLayoutMetric;
  richItem: RichInlineItem | null;
  text: string;
  width: number;
};

export type InlineReferenceLayoutMetric =
  | {
      end: number;
      kind: "image";
      start: number;
      width: number;
    }
  | {
      end: number;
      kind: "mention";
      start: number;
      width: number;
    }
  | {
      end: number;
      iconSegmentWidth: number;
      kind: "resource";
      start: number;
      width: number;
    };

export type InlineReferenceSignature = {
  hasMutableResourceDependency: boolean;
  signature: string;
};

export function resolveInlineReferenceMeasurement(
  run: IndexedInline,
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  {
    availableWidth,
    typography,
    resources,
  }: {
    availableWidth: number;
    typography: BlockTypography;
    resources: DocumentResources;
  },
): InlineReferenceMeasurement | null {
  if (run.node.type === "image") {
    const dimensions = resolveInlineImageDimensions(run, resources, availableWidth);

    return {
      height: dimensions.height,
      inlineReference: {
        end: run.end,
        kind: "image",
        start: run.start,
        width: dimensions.width,
      },
      richItem: null,
      text: indexedInlineText(run),
      width: dimensions.width,
    };
  }

  const styledFont = resolveInlineTextStyle(typography, inlineMarks(run)).font;

  if (run.node.type === "mention") {
    context.font = styledFont;
    const width = measureInlineMentionWidth(context, run.node);

    return {
      height: typography.lineHeight,
      inlineReference: {
        end: run.end,
        kind: "mention",
        start: run.start,
        width,
      },
      richItem: {
        break: "never",
        extraWidth: mentionHorizontalPadding * 2,
        font: styledFont,
        text: `@${run.node.name}`,
      },
      text: indexedInlineText(run),
      width,
    };
  }

  if (run.node.type !== "resource" || resources.resourceRegistry.protocols.size === 0) {
    return null;
  }

  const resource = resolveInlineResource(run, resources.resourceRegistry);

  if (!resource) {
    return null;
  }

  context.font = styledFont;
  const iconSegmentWidth = measureInlineResourceIconSegmentWidth(context, resource.icon);
  const width = measureInlineResourceWidth(context, resource);

  return {
    height: typography.lineHeight,
    inlineReference: {
      end: run.end,
      iconSegmentWidth,
      kind: "resource",
      start: run.start,
      width,
    },
    richItem: {
      break: "never",
      extraWidth: resourceHorizontalPadding * 2 + iconSegmentWidth,
      font: styledFont,
      text: resource.label,
    },
    text: indexedInlineText(run),
    width,
  };
}

export function resolveInlineReferenceSignature(
  run: IndexedInline,
  resources: DocumentResources,
): InlineReferenceSignature | null {
  if (run.node.type === "image") {
    return {
      hasMutableResourceDependency: true,
      signature: resolveInlineImageSignature(run, resources),
    };
  }

  if (run.node.type === "mention") {
    return {
      hasMutableResourceDependency: false,
      signature: `mention:${run.node.userId}:${run.node.name}`,
    };
  }

  if (run.node.type !== "resource" || resources.resourceRegistry.protocols.size === 0) {
    return null;
  }

  const resource = resolveInlineResource(run, resources.resourceRegistry);

  if (!resource) {
    return null;
  }

  return {
    hasMutableResourceDependency: true,
    signature: `resource:${resource.url}:${resource.label}:${createResourceIconSignature(resource.icon)}`,
  };
}
