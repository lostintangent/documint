import type { DocumentResourceIcon, DocumentResourceIconNode } from "@/editor";

export function lucideResourceIcon(node: DocumentResourceIconNode): DocumentResourceIcon {
  return { node, type: "svg" };
}
