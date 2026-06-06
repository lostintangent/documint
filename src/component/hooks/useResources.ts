import { useEffect, useMemo, useRef } from "react";
import { normalizeResourceProtocol } from "@/document";
import { createResourceIconSignature, createResourceReference } from "@/editor";
import type {
  DocumentResourceProtocol,
  DocumentResourceReference,
  DocumentResourceRegistry,
} from "@/types";
import { resourceUrlsSprig, useSprig } from "../store";

export type ResourceProtocolRecord =
  | ReadonlyMap<string, DocumentResourceProtocol>
  | Record<string, DocumentResourceProtocol>;

export type ActiveResourceSet = ReadonlySet<string> | readonly string[] | Record<string, boolean>;

export type ResolvedResourceProtocols = {
  key: string;
  layoutKey: string;
  protocols: ReadonlyMap<string, DocumentResourceProtocol>;
};

const emptyActiveResources = new Set<string>();

export function useResourceProtocols(protocols: ResourceProtocolRecord | undefined) {
  /* Protocol normalization */

  const normalizedProtocols = useMemo(() => normalizeResourceProtocolMap(protocols), [protocols]);
  const key = useMemo(() => createResourceProtocolKey(normalizedProtocols), [normalizedProtocols]);
  const layoutKey = useMemo(
    () => createResourceProtocolLayoutKey(normalizedProtocols),
    [normalizedProtocols],
  );

  /* Public API */

  return useMemo(
    () => ({
      key,
      layoutKey,
      protocols: normalizedProtocols,
    }),
    [key, layoutKey, normalizedProtocols],
  );
}

export function useResources({
  onResourcesRequested,
  resourceProtocols,
  resources,
}: {
  onResourcesRequested?: (resources: readonly DocumentResourceReference[]) => void;
  resourceProtocols: ResolvedResourceProtocols;
  resources?: ActiveResourceSet;
}): DocumentResourceRegistry {
  /* Resource registry */

  const { protocols } = resourceProtocols;
  const activeResources = useMemo(() => normalizeActiveResources(resources), [resources]);
  const resourceUrls = useSprig(resourceUrlsSprig);
  const registry = useMemo(
    () => ({
      active: activeResources,
      protocols,
    }),
    [activeResources, protocols],
  );

  /* Discovered-resource requests */

  const lastRequestedResourceKeyRef = useRef("");

  useEffect(() => {
    if (!onResourcesRequested) {
      return;
    }

    if (protocols.size === 0) {
      lastRequestedResourceKeyRef.current = "";
      return;
    }

    const discovered = resolveDiscoveredResourceReferences(resourceUrls, protocols);
    const discoveredResourceKey = discovered
      .map((resource) => resource.url)
      .sort()
      .join("\u0000");

    if (!discoveredResourceKey) {
      lastRequestedResourceKeyRef.current = "";
      return;
    }

    if (discoveredResourceKey !== lastRequestedResourceKeyRef.current) {
      lastRequestedResourceKeyRef.current = discoveredResourceKey;
      onResourcesRequested(discovered);
    }
  }, [resourceUrls, onResourcesRequested, protocols]);

  /* Public API */

  return registry;
}

export function resolveDiscoveredResourceReferences(
  urls: ReadonlySet<string>,
  protocols: ReadonlyMap<string, DocumentResourceProtocol>,
) {
  const discovered: DocumentResourceReference[] = [];
  const lookupRegistry = { active: emptyActiveResources, protocols };

  for (const url of urls) {
    const resource = createResourceReference(url, lookupRegistry);

    if (resource) {
      discovered.push(resource);
    }
  }

  return discovered;
}

export function normalizeResourceProtocolMap(value: ResourceProtocolRecord | undefined) {
  const entries = normalizeRecordMap(value);
  const protocols = new Map<string, DocumentResourceProtocol>();

  for (const [protocol, spec] of entries) {
    const canonicalProtocol = normalizeResourceProtocol(protocol);

    if (canonicalProtocol) {
      protocols.set(canonicalProtocol, spec);
    }
  }

  return protocols;
}

export function createResourceProtocolKey(
  protocols: ReadonlyMap<string, DocumentResourceProtocol>,
) {
  return [...protocols.keys()]
    .map((protocol) => protocol.toLowerCase())
    .sort()
    .join("\u0000");
}

export function createResourceProtocolLayoutKey(
  protocols: ReadonlyMap<string, DocumentResourceProtocol>,
) {
  return [...protocols]
    .map(
      ([protocol, spec]) =>
        `${protocol.toLowerCase()}\u0001${createResourceIconSignature(spec.icon)}\u0001${spec.label}`,
    )
    .sort()
    .join("\u0000");
}

export function createActiveResourceKey(resources: ReadonlySet<string>) {
  return [...resources].sort().join("\u0000");
}

function normalizeRecordMap<T>(value: ReadonlyMap<string, T> | Record<string, T> | undefined) {
  if (!value) {
    return new Map<string, T>();
  }

  return value instanceof Map ? value : new Map(Object.entries(value));
}

function normalizeActiveResources(value: ActiveResourceSet | undefined) {
  if (!value) {
    return emptyActiveResources;
  }

  if (value instanceof Set) {
    return value;
  }

  if (Array.isArray(value)) {
    return new Set(value);
  }

  const active = new Set<string>();
  for (const [url, isActive] of Object.entries(value)) {
    if (isActive) {
      active.add(url);
    }
  }
  return active;
}
