import type { DocumentResourceIcon, DocumentResourceIconNode } from "@/types";

export function lucideResourceIcon(node: DocumentResourceIconNode): DocumentResourceIcon {
  return { node, type: "svg" };
}
