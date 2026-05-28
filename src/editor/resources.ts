import type {
  DocumentResourceIcon,
  DocumentResources,
  DocumentResourceProtocol,
  DocumentResourceReference,
  DocumentResourceRegistry,
} from "@/types";
import type { Resource } from "@/document";
import { resolveResourceProtocol } from "@/resources";
import { someVisibleDocumentLayoutLine, type EditorLayoutState } from "./layout";
import { resolveRegion, type EditorState, type InlineEntry } from "./state";

export type ResolvedResource = {
  icon: DocumentResourceIcon | null;
  isActive: boolean;
  label: string;
  protocol: string;
  protocolSpec: DocumentResourceProtocol;
  url: string;
};

export const emptyDocumentResources: DocumentResources = {
  images: new Map(),
  resourceRegistry: { active: new Set(), protocols: new Map() },
};

export function createResourceReference(
  url: string,
  registry: DocumentResourceRegistry,
): DocumentResourceReference | null {
  const protocol = resolveResourceProtocol(url);

  return protocol && registry.protocols.has(protocol) ? { protocol, url } : null;
}

export function resolveInlineResource(
  inline: InlineEntry,
  registry: DocumentResourceRegistry,
): ResolvedResource | null {
  if (inline.node.type !== "resource") {
    return null;
  }

  return resolveResource(inline.node, registry);
}

export function resolveResource(
  resource: Resource,
  registry: DocumentResourceRegistry,
): ResolvedResource | null {
  const protocolSpec = registry.protocols.get(resource.protocol);

  if (!protocolSpec) {
    return null;
  }

  const label = resource.label || protocolSpec.label;
  const icon = protocolSpec.icon ?? null;

  return {
    icon,
    isActive: registry.active.has(resource.url),
    label,
    protocol: resource.protocol,
    protocolSpec,
    url: resource.url,
  };
}

export function hasActiveResourcesInViewport(
  state: EditorState,
  viewport: EditorLayoutState,
  registry: DocumentResourceRegistry,
): boolean {
  if (registry.active.size === 0 || registry.protocols.size === 0) {
    return false;
  }

  return someVisibleDocumentLayoutLine(viewport, (line) => {
    const region = resolveRegion(state.documentIndex, line.regionId);
    if (region?.content.kind !== "inline-text") {
      return false;
    }

    return region.content.inlines.some(
      (inline) =>
        inline.node.type === "resource" &&
        inline.end > line.start &&
        inline.start < line.end &&
        registry.active.has(inline.node.url) &&
        registry.protocols.has(inline.node.protocol),
    );
  });
}
