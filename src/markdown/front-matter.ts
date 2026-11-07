import type { DocumentMetadata, MetadataValue } from "@/document";
import { lineFeed } from "./shared";

export const metadataFence = "---";

const metadataFieldPattern = /^([A-Za-z_][A-Za-z0-9_-]*|"(?:\\.|[^"\\])*"):(?: (.*))?$/;
const reservedPlainScalarPattern = /^(?:false|null|no|off|on|true|yes)$/i;
const forbiddenPlainScalarStartPattern = /^[!&*[\]{},#|>@`"'%~?:+\-.0-9]/;
const literalBlockIndicatorPattern = /^\|2?[-+]?$/;

export function parseMetadataPreambleLines(lines: readonly string[]): DocumentMetadata {
  return parseStructuredMetadata(lines) ?? { raw: lines.join(lineFeed) };
}

export function serializeMetadataPreamble(metadata: DocumentMetadata | null): string {
  if (metadata === null) {
    return "";
  }

  if ("raw" in metadata) {
    return [metadataFence, metadata.raw, metadataFence].join(lineFeed);
  }

  return [metadataFence, ...[...metadata].map(serializeMetadataField), metadataFence].join(
    lineFeed,
  );
}

function parseStructuredMetadata(
  lines: readonly string[],
): ReadonlyMap<string, MetadataValue> | null {
  const metadata = new Map<string, MetadataValue>();

  for (let index = 0; index < lines.length;) {
    const field = parseMetadataField(lines[index] ?? "");

    if (!field || metadata.has(field.key)) {
      return null;
    }

    if (literalBlockIndicatorPattern.test(field.valueSource)) {
      const literal = parseLiteralBlock(lines, index, field.valueSource);
      metadata.set(field.key, literal.value);
      index = literal.nextIndex;
      continue;
    }

    const value = parseSingleLineValue(field.valueSource);
    if (value === null) {
      return null;
    }

    metadata.set(field.key, value);
    index += 1;
  }

  return metadata;
}

function parseMetadataField(line: string): { key: string; valueSource: string } | null {
  const match = metadataFieldPattern.exec(line);

  if (!match) {
    return null;
  }

  const sourceKey = match[1]!;
  const key = sourceKey.startsWith('"') ? parseJsonString(sourceKey) : sourceKey;
  return key === null ? null : { key, valueSource: match[2] ?? "" };
}

function parseSingleLineValue(source: string): MetadataValue | null {
  if (source === "true") {
    return true;
  }

  if (source === "false") {
    return false;
  }

  if (source.startsWith('"')) {
    return parseJsonString(source);
  }

  return isPlainString(source) ? source : null;
}

function parseJsonString(source: string) {
  try {
    const value: unknown = JSON.parse(source);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function isPlainString(source: string) {
  return (
    source.length > 0 &&
    source.trim() === source &&
    !reservedPlainScalarPattern.test(source) &&
    !forbiddenPlainScalarStartPattern.test(source) &&
    !source.includes(": ") &&
    !source.includes(" #")
  );
}

function parseLiteralBlock(lines: readonly string[], fieldIndex: number, indicator: string) {
  const contentLines: string[] = [];
  let indentation = indicator.startsWith("|2") ? 2 : null;
  let nextIndex = fieldIndex + 1;

  while (nextIndex < lines.length) {
    const line = lines[nextIndex]!;

    if (line === "") {
      contentLines.push("");
      nextIndex += 1;
      continue;
    }

    const leadingSpaces = /^ */.exec(line)![0].length;
    if (indentation === null) {
      if (leadingSpaces === 0) {
        break;
      }
      indentation = leadingSpaces;
    }

    if (leadingSpaces < indentation) {
      break;
    }

    contentLines.push(line.slice(indentation));
    nextIndex += 1;
  }

  const content = contentLines.join(lineFeed);
  const stripped = content.replace(/\n+$/, "");
  let value = stripped;

  if (!indicator.endsWith("-") && stripped.length > 0) {
    value += lineFeed;
  }
  if (indicator.endsWith("+") && contentLines.length > 0) {
    value = `${content}${lineFeed}`;
  }

  return { nextIndex, value };
}

function serializeMetadataField([key, value]: [string, MetadataValue]) {
  const sourceKey = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);

  if (typeof value === "boolean") {
    return `${sourceKey}: ${value}`;
  }

  if (!value.includes(lineFeed)) {
    return `${sourceKey}: ${JSON.stringify(value)}`;
  }

  const indicator = resolveLiteralBlockIndicator(value);
  const content = indicator.endsWith("-") ? value : value.slice(0, -1);
  const indentedContent = content
    .split(lineFeed)
    .map((line) => (line.length === 0 ? "" : `  ${line}`))
    .join(lineFeed);

  return `${sourceKey}: ${indicator}${lineFeed}${indentedContent}`;
}

function resolveLiteralBlockIndicator(value: string): string {
  const firstContentLine = value.split(lineFeed).find((line) => line.length > 0);
  const indentation = firstContentLine?.startsWith(" ") ? "2" : "";
  const trailingLineFeeds = /\n+$/.exec(value)?.[0].length ?? 0;
  const chomping =
    /^\n+$/.test(value) || trailingLineFeeds > 1 ? "+" : trailingLineFeeds === 0 ? "-" : "";

  return `|${indentation}${chomping}`;
}
