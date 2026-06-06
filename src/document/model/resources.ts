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
