import type { CommentThread } from "./comments";

export type Document = {
  blocks: Block[];
  comments: CommentThread[];
  frontMatter?: string;
};

// A `Fragment` is a clipboard-shaped sub-document. Three shapes capture
// every clipboard payload at the right altitude:
//
//   - `text`: pure characters with no marks or structure. Pastes via the
//     inline replace fast path — same as typing.
//   - `inlines`: a sequence of inline nodes (text with marks, links,
//     images, code spans, breaks). Pastes inside the destination's
//     leaf without disturbing surrounding block structure — so pasting
//     `*italic*` mid-list-item stays inline in the item.
//   - `blocks`: full block-level content. Pastes structurally with
//     seam-merge.
//
// Comments and front matter never travel through any variant. Format
// conversion (markdown ↔ Fragment) lives in the markdown subsystem; the
// editor consumes Fragments without knowing how they were produced.
export type Fragment =
  | { kind: "text"; text: string }
  | { kind: "inlines"; inlines: Inline[] }
  | { kind: "blocks"; blocks: Block[] };

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | ListItemBlock
  | BlockquoteBlock
  | TableBlock
  | DividerBlock
  | CodeBlock
  | DirectiveBlock
  | RawBlock;

export type Inline = Text | Link | Image | Code | LineBreak | Raw;

// Every document node carries an `id` and a literal `type` discriminator. Block
// nodes additionally carry a `plainText` projection for search/serialization.
// The `K` parameter pins the discriminator as a string literal so discriminated
// union narrowing continues to work across the whole `Block` / `Inline` union.
type DocumentNode<K extends string, P = {}> = { id: string; type: K } & P;
type BlockNode<K extends string, P = {}> = DocumentNode<K, { plainText: string } & P>;

export type ParagraphBlock = BlockNode<"paragraph", { children: Inline[] }>;

export type HeadingBlock = BlockNode<
  "heading",
  {
    children: Inline[];
    depth: 1 | 2 | 3 | 4 | 5 | 6;
  }
>;

export type ListBlock = BlockNode<
  "list",
  {
    items: ListItemBlock[];
    ordered: boolean;
    spread: boolean;
    start: number | null;
  }
>;

export type ListItemBlock = BlockNode<
  "listItem",
  {
    checked: boolean | null;
    children: Block[];
    spread: boolean;
  }
>;

export type BlockquoteBlock = BlockNode<"blockquote", { children: Block[] }>;

export type TableBlock = BlockNode<
  "table",
  {
    align: Array<"center" | "left" | "right" | null>;
    rows: TableRow[];
  }
>;

export type TableRow = {
  cells: TableCell[];
  id: string;
};

export type TableCell = {
  children: Inline[];
  id: string;
  plainText: string;
};

export type DividerBlock = BlockNode<"thematicBreak">;

export type CodeBlock = BlockNode<
  "code",
  {
    language: string | null;
    meta: string | null;
    source: string;
  }
>;

export type DirectiveBlock = BlockNode<
  "directive",
  {
    attributes: string;
    body: string;
    name: string;
  }
>;

export type RawBlock = BlockNode<
  "unsupported",
  {
    originalType: string;
    source: string;
  }
>;

export type Mark = "bold" | "italic" | "strikethrough" | "underline";

export type Text = DocumentNode<
  "text",
  {
    marks: Mark[];
    text: string;
  }
>;

export type Link = DocumentNode<
  "link",
  {
    children: Inline[];
    title: string | null;
    url: string;
  }
>;

export type Image = DocumentNode<
  "image",
  {
    alt: string | null;
    title: string | null;
    url: string;
    width: number | null;
  }
>;

export type LineBreak = DocumentNode<"break">;

export type Code = DocumentNode<"inlineCode", { code: string }>;

export type Raw = DocumentNode<
  "unsupported",
  {
    originalType: string;
    source: string;
  }
>;
