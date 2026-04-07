// Semantic document queries built on the shared walker API.
import {
  visitBlockTree,
  type DocumentVisitor,
  visitDocument,
} from "./visit";
import type {
  Block,
  Document,
} from "./types";

export function collectImageUrls(document: Document) {
  const urls = new Set<string>();

  visitDocument(document, {
    enterInline(node) {
      if (node.type === "image") {
        urls.add(node.url);
      }
    },
  });

  return [...urls];
}

export function findBlockById(subject: Document | Block[], blockId: string): Block | null {
  let match: Block | null = null;

  visitSubject(subject, {
    enterBlock(block) {
      if (block.id === blockId) {
        match = block;
        return "stop";
      }
    },
  });

  return match;
}

function visitSubject(subject: Document | Block[], visitor: DocumentVisitor) {
  if (Array.isArray(subject)) {
    visitBlockTree(subject, visitor);
    return;
  }

  visitDocument(subject, visitor);
}
