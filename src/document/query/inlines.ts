import type { Image, Inline, Mention, Resource } from "../model/types";

export type Reference = Image | Mention | Resource;

// References are inline nodes whose durable document payload points outside
// plain editable text: an image URL, a mentioned user, or a host-registered
// resource URI. Higher layers can share this semantic classification instead
// of repeating per-kind switches for every reference kind.
export function isReferenceInlineNode(node: Inline): node is Reference {
  return node.type === "image" || node.type === "mention" || node.type === "resource";
}
