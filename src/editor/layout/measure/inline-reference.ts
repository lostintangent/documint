// Shared layout measurement policy for document reference inlines. Each
// reference still owns its own visual semantics, but text layout can consume
// one normalized measurement shape instead of branching on every reference
// kind in every measurement phase.

import type { RichInlineItem } from "@chenglou/pretext/rich-inline";
import type { Mark } from "@/document";
import type { DocumentResources } from "@/types";
import { resolveInlineResource } from "@/editor/resources";
import { createResourceIconSignature } from "@/resources";
import type { InlineEntry } from "../../state";
import { resolveInlineTextStyle } from "../../text/fonts";
import { resolveInlineImageDimensions, resolveInlineImageSignature } from "./inline-image";
import { measureInlineMentionWidth, mentionHorizontalPadding } from "./inline-mention";
import {
  measureInlineResourceIconSegmentWidth,
  measureInlineResourceWidth,
  resourceHorizontalPadding,
} from "./inline-resource";

export type InlineReferenceMeasurement = {
  height: number;
  richItem: RichInlineItem | null;
  text: string;
  width: number;
};

export type InlineReferenceSignature = {
  hasMutableResourceDependency: boolean;
  signature: string;
};

export function resolveInlineReferenceMeasurement(
  run: InlineEntry,
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  {
    availableWidth,
    font,
    lineHeight,
    resources,
  }: {
    availableWidth: number;
    font: string;
    lineHeight: number;
    resources: DocumentResources;
  },
): InlineReferenceMeasurement | null {
  if (run.node.type === "image") {
    const dimensions = resolveInlineImageDimensions(run, resources, availableWidth);

    return {
      height: dimensions.height,
      richItem: null,
      text: run.text,
      width: dimensions.width,
    };
  }

  const styledFont = resolveInlineTextStyle(font, inlineMarks(run), inlineIsCode(run)).font;

  if (run.node.type === "mention") {
    context.font = styledFont;

    return {
      height: lineHeight,
      richItem: {
        break: "never",
        extraWidth: mentionHorizontalPadding * 2,
        font: styledFont,
        text: `@${run.node.name}`,
      },
      text: run.text,
      width: measureInlineMentionWidth(context, run.node),
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

  return {
    height: lineHeight,
    richItem: {
      break: "never",
      extraWidth:
        resourceHorizontalPadding * 2 + measureInlineResourceIconSegmentWidth(context, resource.icon),
      font: styledFont,
      text: resource.label,
    },
    text: run.text,
    width: measureInlineResourceWidth(context, resource),
  };
}

export function resolveInlineReferenceSignature(
  run: InlineEntry,
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

function inlineMarks(run: InlineEntry): readonly Mark[] {
  return run.node.type === "text" ? run.node.marks : [];
}

function inlineIsCode(run: InlineEntry): boolean {
  return run.node.type === "code";
}
