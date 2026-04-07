import type { Document } from "@/document";
import { createMarkdownSerializer, parseMarkdownToMdast } from "./remark";
import { fromDocument } from "./from-document";
import { toDocument, type MarkdownParseOptions } from "./to-document";

export function parseMarkdown(source: string, options?: MarkdownParseOptions) {
  return toDocument(parseMarkdownToMdast(source.replace(/\r\n/g, "\n")), options);
}

export function serializeMarkdown(document: Document) {
  const root = fromDocument(document);

  if (root.children.length === 0) {
    return "";
  }

  const result = createMarkdownSerializer().stringify(root);

  return result.endsWith("\n") ? result : `${result}\n`;
}
