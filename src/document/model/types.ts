import type { CommentThread } from "../comments";

/* Core document types */

export type Document = {
  blocks: Block[];
  comments: CommentThread[];

  // TODO: Parse this as structured metadata
  // as opposed to leaking Markdown concepts
  frontMatter?: string;
};

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | ListItemBlock
  | TableBlock
  | BlockquoteBlock
  | DividerBlock
  | CodeBlock
  | DirectiveBlock
  | RawBlock;

export type Inline = Text | Link | Image | Mention | Resource | LineBreak | Raw;

export type Reference = Image | Mention | Resource;

// References are inline nodes whose durable document payload points outside plain
// editable text: an image URL, a mentioned user, or a host-registered resource
// URI. Higher layers share this classification instead of repeating per-kind
// switches for every reference kind.
export function isReferenceInlineNode(node: Inline): node is Reference {
  return node.type === "image" || node.type === "mention" || node.type === "resource";
}

export type Fragment =
  | { kind: "text"; text: string }
  | { kind: "inlines"; inlines: Inline[] }
  | { kind: "blocks"; blocks: Block[] };

/* Block types */

export type ParagraphBlock = BlockNode<"paragraph", { children: Inline[] }>;

export type HeadingBlock = BlockNode<
  "heading",
  {
    depth: 1 | 2 | 3 | 4 | 5 | 6;
    children: Inline[];
  }
>;

export type ListBlock = BlockNode<
  "list",
  {
    ordered: boolean;
    items: ListItemBlock[];
    start: number | null;
    compact: boolean;
  }
>;

export type ListItemBlock = BlockNode<
  "listItem",
  {
    checked: boolean | null;
    children: Block[];
    compact: boolean;
  }
>;

export type BlockquoteBlock = BlockNode<"blockquote", { children: Block[] }>;

export type TableBlock = BlockNode<
  "table",
  {
    rows: TableRow[];
    align: Array<"center" | "left" | "right" | null>;
  }
>;

export type TableRow = {
  cells: TableCell[];
};

export type TableCell = {
  children: Inline[];
  plainText: string;
};

export type DividerBlock = BlockNode<"divider">;

export type CodeBlock = BlockNode<
  "code",
  {
    language: string | null;
    source: string;
    meta: string | null;
  }
>;

export type DirectiveBlock = BlockNode<
  "directive",
  {
    name: string;
    body: string;
    attributes: string;
  }
>;

export type RawBlock = BlockNode<
  "raw",
  {
    originalType: string;
    source: string;
  }
>;

export type BlockContentKind = "inlines" | "blocks" | "cells" | "source" | "void";
export function blockContentKind(block: Block): BlockContentKind {
  switch (block.type) {
    case "paragraph":
    case "heading":
      return "inlines";

    case "blockquote":
    case "list":
    case "listItem":
      return "blocks";

    case "table":
      return "cells";

    case "code":
    case "raw":
      return "source";

    case "divider":
    case "directive":
      return "void";
  }
}

/* Inline types */

export type Text = InlineNode<
  "text",
  {
    marks: Mark[];
    text: string;
  }
>;

export type Mark = "bold" | "italic" | "underline" | "strikethrough" | "code" | "superscript";

export type Link = InlineNode<
  "link",
  {
    children: Inline[];
    title: string | null;
    url: string;
  }
>;

export type Image = InlineNode<
  "image",
  {
    alt: string | null;
    title: string | null;
    url: string;
    width: number | null;
  }
>;

export type Mention = InlineNode<
  "mention",
  {
    name: string;
    userId: string;
  }
>;

export type MentionTarget = Pick<Mention, "name" | "userId">;

export type Resource = InlineNode<
  "resource",
  {
    label: string;
    protocol: string;
    url: string;
  }
>;

export type LineBreak = InlineNode<"lineBreak">;

export type Raw = InlineNode<
  "raw",
  {
    originalType: string;
    source: string;
  }
>;

/* Type definition utilities */

type BlockNode<K extends string, P = {}> = { type: K; plainText: string } & P;
type InlineNode<K extends string, P = {}> = { type: K } & P;
