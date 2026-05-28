import { normalizeResourceProtocols, type MarkdownOptions } from "../shared";

export type MarkdownParseContext = {
  baseIndent: number;
  options: MarkdownOptions;
  resourceProtocols: ReadonlySet<string>;
};

export function createMarkdownParseContext(
  options: MarkdownOptions,
  baseIndent = 0,
): MarkdownParseContext {
  return {
    baseIndent,
    options,
    resourceProtocols: normalizeResourceProtocols(options.resourceProtocols),
  };
}

export function withBaseIndent(
  context: MarkdownParseContext,
  baseIndent: number,
): MarkdownParseContext {
  return context.baseIndent === baseIndent
    ? context
    : {
        ...context,
        baseIndent,
      };
}
