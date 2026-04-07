import type { CommentThread } from "@/comments";

export type Mark = "bold" | "italic" | "strikethrough" | "underline";

export type Text = {
  id: string;
  marks: Mark[];
  text: string;
  type: "text";
};

export type LineBreak = {
  id: string;
  type: "break";
};

export type Code = {
  code: string;
  id: string;
  type: "inlineCode";
};

export type Link = {
  children: Inline[];
  id: string;
  title: string | null;
  type: "link";
  url: string;
};

export type Image = {
  alt: string | null;
  id: string;
  title: string | null;
  type: "image";
  url: string;
  width: number | null;
};

export type Raw = {
  id: string;
  originalType: string;
  raw: string;
  type: "unsupported";
};

export type Inline =
  | LineBreak
  | Image
  | Code
  | Link
  | Text
  | Raw;

export type ParagraphBlock = {
  children: Inline[];
  id: string;
  plainText: string;
  type: "paragraph";
};

export type HeadingBlock = {
  children: Inline[];
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  id: string;
  plainText: string;
  type: "heading";
};

export type ListBlock = {
  children: ListItemBlock[];
  id: string;
  ordered: boolean;
  plainText: string;
  spread: boolean;
  start: number | null;
  type: "list";
};

export type ListItemBlock = {
  checked: boolean | null;
  children: Block[];
  id: string;
  plainText: string;
  spread: boolean;
  type: "listItem";
};

export type BlockquoteBlock = {
  children: Block[];
  id: string;
  plainText: string;
  type: "blockquote";
};

export type CodeBlock = {
  id: string;
  language: string | null;
  meta: string | null;
  plainText: string;
  type: "code";
  value: string;
};

export type TableCell = {
  children: Inline[];
  id: string;
  plainText: string;
};

export type TableRow = {
  cells: TableCell[];
  id: string;
};

export type TableBlock = {
  align: Array<"center" | "left" | "right" | null>;
  id: string;
  plainText: string;
  rows: TableRow[];
  type: "table";
};

export type DividerBlock = {
  id: string;
  plainText: string;
  type: "thematicBreak";
};

export type RawBlock = {
  id: string;
  originalType: string;
  plainText: string;
  raw: string;
  type: "unsupported";
};

export type Block =
  | BlockquoteBlock
  | CodeBlock
  | HeadingBlock
  | ListBlock
  | ListItemBlock
  | ParagraphBlock
  | TableBlock
  | DividerBlock
  | RawBlock;

export type Document = {
  blocks: Block[];
  comments: CommentThread[];
};

export type DocumentInit = {
  blocks: Block[];
  comments?: CommentThread[];
};
