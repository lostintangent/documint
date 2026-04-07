/**
 * Translates semantic `Document` snapshots into mdast roots for markdown
 * stringification. This file owns both the ordinary document-to-mdast mapping
 * and the markdown-only emission that accompanies it.
 */
import type {
  Block,
  Document,
  Inline,
  ListItemBlock,
  TableCell,
  TableRow,
  Text,
} from "@/document";
import {
  COMMENT_APPENDIX_DIRECTIVE_NAME,
  serializeCommentAppendixPayload,
} from "@/comments";
import type { MarkdownImageWithWidth } from "./remark/image-width";
import { serializeUnderline } from "./remark/underline";
import type {
  BlockContent,
  Code as MdastCode,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  TableCell as MdastTableCell,
  TableRow as MdastTableRow,
} from "mdast";

export function fromDocument(document: Document): Root {
  return {
    type: "root",
    children: [
      ...fromDocumentBlockChildren(document.blocks),
      ...fromDocumentCommentAppendix(document.comments),
    ],
  };
}

function fromDocumentBlock(node: Block): RootContent[] {
  switch (node.type) {
    case "blockquote":
      return [
        {
          type: "blockquote",
          children: fromDocumentBlockChildren(node.children),
        },
      ];
    case "code":
      return [
        {
          lang: node.language ?? undefined,
          meta: node.meta ?? undefined,
          type: "code",
          value: node.value,
        },
      ];
    case "heading":
      return [
        {
          children: fromDocumentInlineNodes(node.children),
          depth: node.depth,
          type: "heading",
        },
      ];
    case "list":
      return [
        {
          children: node.children.map((child) => fromDocumentListItem(child)),
          ordered: node.ordered,
          spread: node.spread,
          start: node.start ?? undefined,
          type: "list",
        },
      ];
    case "listItem":
      return [fromDocumentListItem(node)];
    case "paragraph":
      return [
        {
          children: fromDocumentInlineNodes(node.children),
          type: "paragraph",
        },
      ];
    case "table":
      return [
        {
          align: node.align,
          children: node.rows.map((row) => fromDocumentTableRow(row)),
          type: "table",
        },
      ];
    case "thematicBreak":
      return [
        {
          type: "thematicBreak",
        },
      ];
    case "unsupported":
      return [
        {
          type: "html",
          value: node.raw,
        },
      ];
  }
}

function fromDocumentListItem(node: ListItemBlock): ListItem {
  return {
    checked: node.checked ?? undefined,
    children: fromDocumentBlockChildren(node.children),
    spread: node.spread,
    type: "listItem",
  };
}

function fromDocumentTableRow(row: TableRow): MdastTableRow {
  return {
    children: row.cells.map((cell) => fromDocumentTableCell(cell)),
    type: "tableRow",
  };
}

function fromDocumentTableCell(cell: TableCell): MdastTableCell {
  return {
    children: fromDocumentInlineNodes(cell.children),
    type: "tableCell",
  };
}

function fromDocumentInlineNodes(nodes: Inline[]): PhrasingContent[] {
  return nodes.flatMap((node) => fromDocumentInline(node));
}

function fromDocumentInline(node: Inline): PhrasingContent[] {
  switch (node.type) {
    case "break":
      return [
        {
          type: "break",
        },
      ];
    case "image":
      return [fromDocumentImage(node)];
    case "inlineCode":
      return [
        {
          type: "inlineCode",
          value: node.code,
        },
      ];
    case "link":
      return [
        {
          children: fromDocumentInlineNodes(node.children),
          title: node.title ?? undefined,
          type: "link",
          url: node.url,
        },
      ];
    case "text":
      return fromDocumentTextNode(node);
    case "unsupported":
      return [
        {
          type: "html",
          value: node.raw,
        },
      ];
  }
}

function fromDocumentTextNode(node: Text): PhrasingContent[] {
  let current: PhrasingContent[] = [{
    type: "text",
    value: node.text,
  }];

  for (const mark of node.marks) {
    if (mark === "underline") {
      current = serializeUnderline(current);
      continue;
    }

    current = [wrapMarkedChildren(mark, current)];
  }

  return current;
}

function fromDocumentBlockChildren(children: Block[]): BlockContent[] {
  return children.flatMap((child) => fromDocumentBlock(child)) as BlockContent[];
}

function fromDocumentImage(node: Extract<Inline, { type: "image" }>): MarkdownImageWithWidth {
  return {
    alt: node.alt ?? undefined,
    data: node.width ? { width: node.width } : undefined,
    title: node.title ?? undefined,
    type: "image",
    url: node.url,
  };
}

function wrapMarkedChildren(
  mark: Exclude<Text["marks"][number], "underline">,
  children: PhrasingContent[],
): PhrasingContent {
  switch (mark) {
    case "strikethrough":
      return { children, type: "delete" };
    case "italic":
      return { children, type: "emphasis" };
    case "bold":
      return { children, type: "strong" };
  }
}

function fromDocumentCommentAppendix(threads: Document["comments"]): RootContent[] {
  if (threads.length === 0) {
    return [];
  }

  const jsonBlock: MdastCode = {
    lang: "json",
    meta: undefined,
    type: "code",
    value: serializeCommentAppendixPayload(threads).trimEnd(),
  };

  return [
    {
      children: [jsonBlock],
      name: COMMENT_APPENDIX_DIRECTIVE_NAME,
      type: "containerDirective",
    } as RootContent,
  ];
}
