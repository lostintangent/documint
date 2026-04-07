/**
 * Translates parsed markdown syntax trees into semantic `Document` snapshots.
 * This file owns both the ordinary mdast-to-document mapping and the
 * markdown-only normalization that happens before the semantic document is
 * built.
 */
import { buildDocument } from "@/document";
import {
  createBlockquoteBlock,
  createLineBreak,
  createCodeBlock,
  createHeadingBlock,
  createImage,
  createCode,
  createLink,
  createListBlock,
  createListItemBlock,
  createParagraphBlock,
  createParagraphTextBlock,
  createTableBlock,
  createTableCell,
  createTableRow,
  createText,
  createDividerBlock,
  createRawBlock,
  createRaw,
  type Block,
  type Inline,
  type Mark,
} from "@/document";
import {
  COMMENT_APPENDIX_DIRECTIVE_NAME,
  parseCommentAppendixPayload,
  type CommentThread,
} from "@/comments";
import { getMarkdownImageWidth } from "./remark/image-width";
import { stringifyMarkdownNode } from "./remark";
import type { UnderlinePhrasingContent } from "./remark/underline";
import type {
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from "mdast";

type MarkdownTextDirectiveNode = {
  children?: MarkdownInlineContent[];
  name: string;
  type: "textDirective";
};

type MarkdownInlineContent =
  | MarkdownTextDirectiveNode
  | PhrasingContent
  | UnderlinePhrasingContent;

type CommentAppendixDirectiveNode = {
  attributes?: Record<string, string | null | undefined> | null;
  children?: RootContent[];
  name: string;
  type: "containerDirective";
};

type CommentAppendixExtraction = {
  children: RootContent[];
  comments: CommentThread[];
};

export type MarkdownParseOptions = {
  preserveOrderedListStart?: boolean;
};

type ResolvedMarkdownParseOptions = Required<MarkdownParseOptions>;

export function toDocument(root: Root, options: MarkdownParseOptions = {}) {
  const resolvedOptions: ResolvedMarkdownParseOptions = {
    preserveOrderedListStart: false,
    ...options,
  };
  const { children, comments } = extractMarkdownCommentAppendix(root);

  return buildDocument({
    blocks: children.map((node) => toDocumentBlock(node, resolvedOptions)),
    comments,
  });
}

function toDocumentBlock(node: RootContent, options: ResolvedMarkdownParseOptions): Block {
  switch (node.type) {
    case "blockquote":
      return createBlockquoteBlock({
        children: node.children.map((child) => toDocumentBlock(child, options)),
      });
    case "code":
      return createCodeBlock({
        language: node.lang ?? null,
        meta: node.meta ?? null,
        value: node.value,
      });
    case "containerDirective":
    case "leafDirective":
      return preserveUnsupportedMarkdownBlock(node);
    case "heading":
      return createHeadingBlock({
        children: toDocumentInlineNodes(node.children),
        depth: node.depth,
      });
    case "html":
      return createRawBlock({
        originalType: node.type,
        raw: node.value,
      });
    case "list":
      return toDocumentListBlock(node, options);
    case "paragraph":
      return createParagraphBlock({
        children: toDocumentInlineNodes(node.children),
      });
    case "table":
      return toDocumentTableBlock(node);
    case "thematicBreak":
      return createDividerBlock();
    default:
      return createRawBlock({
        originalType: node.type,
        raw: node.type,
      });
  }
}

function toDocumentListBlock(node: List, options: ResolvedMarkdownParseOptions) {
  return createListBlock({
    children: node.children.map((child) => toDocumentListItem(child, options)),
    ordered: node.ordered ?? false,
    spread: node.spread ?? false,
    start: resolveOrderedListStart(node, options),
  });
}

function toDocumentListItem(node: ListItem, options: ResolvedMarkdownParseOptions) {
  const implicitChecked = getImplicitMarkdownTaskState(node);
  const spread = node.spread ?? false;

  if (implicitChecked !== null) {
    return createListItemBlock({
      checked: implicitChecked,
      children: [createEmptyListItemParagraph()],
      spread,
    });
  }

  const children = node.children.map((child) => toDocumentBlock(child, options));

  return createListItemBlock({
    checked: node.checked ?? null,
    children: children.length > 0 ? children : [createEmptyListItemParagraph()],
    spread,
  });
}

function resolveOrderedListStart(node: List, options: ResolvedMarkdownParseOptions) {
  return node.ordered && options.preserveOrderedListStart
    ? node.start ?? null
    : null;
}

function toDocumentTableBlock(node: Table) {
  return createTableBlock({
    align: node.align ?? [],
    rows: node.children.map((row) =>
      createTableRow({
        cells: row.children.map((cell) =>
          createTableCell({
            children: toDocumentInlineNodes(cell.children),
          }),
        ),
      }),
    ),
  });
}

function createEmptyListItemParagraph() {
  return createParagraphTextBlock({
    text: "",
  });
}

function toDocumentInlineNodes(
  children: MarkdownInlineContent[],
  marks: Mark[] = [],
): Inline[] {
  return children.flatMap((child) => {
    switch (child.type) {
      case "break":
        return [createLineBreak()];
      case "delete":
        return toMarkedDocumentInlineNodes(child.children, marks, "strikethrough");
      case "emphasis":
        return toMarkedDocumentInlineNodes(child.children, marks, "italic");
      case "html":
        return [createRaw({
          originalType: child.type,
          raw: child.value,
        })];
      case "image":
        return [createImage({
          alt: child.alt ?? null,
          title: child.title ?? null,
          url: child.url,
          width: getMarkdownImageWidth(child),
        })];
      case "inlineCode":
        return [createCode({
          code: child.value,
        })];
      case "link":
        return [createLink({
          children: toDocumentInlineNodes(child.children, marks),
          title: child.title ?? null,
          url: child.url,
        })];
      case "strong":
        return toMarkedDocumentInlineNodes(child.children, marks, "bold");
      case "text":
        return [createText({
          marks,
          text: child.value,
        })];
      case "textDirective":
        return [preserveUnsupportedMarkdownInline(child)];
      case "underline":
        return toMarkedDocumentInlineNodes(child.children, marks, "underline");
      default:
        return [createRaw({
          originalType: child.type,
          raw: child.type,
        })];
    }
  });
}

function toMarkedDocumentInlineNodes(
  children: MarkdownInlineContent[],
  marks: Mark[],
  mark: Mark,
) {
  return toDocumentInlineNodes(children, [...marks, mark]);
}

function preserveUnsupportedMarkdownBlock(node: RootContent): Block {
  return createRawBlock({
    originalType: node.type,
    raw: stringifyMarkdownNode(node),
  });
}

function preserveUnsupportedMarkdownInline(node: MarkdownInlineContent): Inline {
  return createRaw({
    originalType: node.type,
    raw: stringifyMarkdownNode(node),
  });
}

function extractMarkdownCommentAppendix(root: Root): CommentAppendixExtraction {
  const children = root.children.filter((node) => {
    if (node.type !== "containerDirective" || node.name !== COMMENT_APPENDIX_DIRECTIVE_NAME) {
      return true;
    }

    return false;
  });
  const appendixNode = root.children.at(-1);

  if (
    appendixNode?.type !== "containerDirective" ||
    appendixNode.name !== COMMENT_APPENDIX_DIRECTIVE_NAME
  ) {
    return {
      children,
      comments: [],
    };
  }

  return {
    children,
    comments: parseCommentAppendixPayload(readMarkdownCommentAppendixBody(appendixNode)),
  };
}

function readMarkdownCommentAppendixBody(node: CommentAppendixDirectiveNode) {
  const firstChild = node.children?.[0];

  if (firstChild?.type === "code") {
    return firstChild.value;
  }

  if (firstChild?.type === "paragraph") {
    return firstChild.children
      .map((child) => ("value" in child ? String(child.value ?? "") : ""))
      .join("");
  }

  return "";
}

function getImplicitMarkdownTaskState(node: ListItem) {
  if (typeof node.checked === "boolean" || node.children.length !== 1) {
    return null;
  }

  const [child] = node.children;

  if (
    child?.type !== "paragraph" ||
    child.children.length !== 1 ||
    child.children[0]?.type !== "text"
  ) {
    return null;
  }

  switch (child.children[0].value) {
    case "[ ]":
      return false;
    case "[x]":
    case "[X]":
      return true;
    default:
      return null;
  }
}
