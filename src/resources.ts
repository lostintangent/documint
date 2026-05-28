import type { DocumentResourceIcon } from "./types";

const protocolPattern = /^([A-Za-z][A-Za-z0-9+.-]*:)/;
const protocolOnlyPattern = /^([A-Za-z][A-Za-z0-9+.-]*):?$/;

export function normalizeResourceProtocol(protocol: string): string | null {
  const trimmed = protocol.trim().toLowerCase();
  const match = protocolOnlyPattern.exec(trimmed);

  if (!match) {
    return null;
  }

  return `${match[1]}:`;
}

export function resolveResourceProtocol(url: string): string | null {
  return protocolPattern.exec(url)?.[1].toLowerCase() ?? null;
}

export function resolveRegisteredResourceProtocol(
  url: string,
  protocols: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): string | null {
  const protocol = resolveResourceProtocol(url);
  return protocol && protocols.has(protocol) ? protocol : null;
}

export function createResourceIconSignature(icon: DocumentResourceIcon | null | undefined): string {
  if (!icon) {
    return "";
  }

  if (typeof icon === "string") {
    return `text:${icon}`;
  }

  return `svg:${icon.node
    .map(([elementName, attrs]) => {
      const attrSignature = Object.entries(attrs)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join(",");
      return `${elementName}(${attrSignature})`;
    })
    .join(";")}`;
}
