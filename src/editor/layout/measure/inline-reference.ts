// Shared layout measurement policy for document reference inlines. Each
// reference still owns its own visual semantics, but text layout can consume
// one normalized measurement shape instead of branching on every reference
// kind in every measurement phase.

import {
  createResourceIconSignature,
  resolveInlineResource,
  type DocumentResources,
} from "@/editor/resources";
import { inlineMarks, type IndexedInline } from "../../state";
import { resolveInlineTextStyle } from "../../text/fonts";
import { resolveInlineImageDimensions, resolveInlineImageSignature } from "./inline-image";
import { measureInlineMentionWidth } from "./inline-mention";
import {
  measureInlineResourceIconSegmentWidth,
  measureInlineResourceWidth,
} from "./inline-resource";
import type { BlockTypography, LayoutTextInput } from "./text";

export type InlineReferenceMeasurement = {
  height: number;
  inlineReference: LayoutInlineReference;
};

export type LayoutInlineReference =
  | {
      end: number;
      height: number;
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
    container,
    typography,
    resources,
  }: {
    availableWidth: number;
    container: LayoutTextInput;
    typography: BlockTypography;
    resources: DocumentResources;
  },
): InlineReferenceMeasurement | null {
  if (run.node.type === "image") {
    const dimensions = resolveInlineImageDimensions(run, resources, {
      availableWidth,
      emSize: typography.baseFontSize,
      standalone: run.start === 0 && run.end === container.text.length,
    });

    return {
      height: dimensions.height,
      inlineReference: {
        end: run.end,
        height: dimensions.height,
        kind: "image",
        start: run.start,
        width: dimensions.width,
      },
    };
  }

  if (run.node.type === "mention") {
    context.font = resolveInlineTextStyle(typography, inlineMarks(run)).font;

    return {
      height: typography.lineHeight,
      inlineReference: {
        end: run.end,
        kind: "mention",
        start: run.start,
        width: measureInlineMentionWidth(context, run.node),
      },
    };
  }

  if (run.node.type !== "resource" || resources.resourceRegistry.protocols.size === 0) {
    return null;
  }

  const resource = resolveInlineResource(run, resources.resourceRegistry);

  if (!resource) {
    return null;
  }

  context.font = resolveInlineTextStyle(typography, inlineMarks(run)).font;
  const iconSegmentWidth = measureInlineResourceIconSegmentWidth(context, resource.icon);

  return {
    height: typography.lineHeight,
    inlineReference: {
      end: run.end,
      iconSegmentWidth,
      kind: "resource",
      start: run.start,
      width: measureInlineResourceWidth(context, resource.label, iconSegmentWidth),
    },
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
