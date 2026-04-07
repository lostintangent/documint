/**
 * Assembles the remark/unified parse and stringify pipelines plus the markdown
 * formatting policy used during serialization.
 */
import type { Content, Root, RootContent } from "mdast";
import type { Options as RemarkStringifyOptions } from "remark-stringify";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import {
  serializeImageWithWidth,
  transformImageWidthChildren,
} from "./image-width";
import {
  transformUnderlineChildren,
  type UnderlinePhrasingContent,
} from "./underline";
import { serializeTaskListItem } from "./task-list";
const markdownSerializerConfig = {
  bullet: "-",
  emphasis: "*",
  fences: true,
  incrementListMarker: false,
  listItemIndent: "one",
  strong: "*",
} satisfies RemarkStringifyOptions;

const markdownParseProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkDocumintExtensions);

export function parseMarkdownToMdast(source: string): Root {
  const tree = markdownParseProcessor.parse(source);
  return markdownParseProcessor.runSync(tree) as Root;
}

export function createMarkdownSerializer() {
  const stringifyOptions: RemarkStringifyOptions = {
    ...markdownSerializerConfig,
    handlers: {
      image: serializeImageWithWidth,
      listItem: serializeTaskListItem,
    },
  };

  return unified()
    .use(remarkDirective)
    .use(remarkGfm)
    .use(remarkStringify, stringifyOptions);
}

const markdownNodeSerializer = createMarkdownSerializer();

export function stringifyMarkdownNode(node: unknown) {
  const value = markdownNodeSerializer.stringify(
    node as Parameters<typeof markdownNodeSerializer.stringify>[0],
  );

  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function remarkDocumintExtensions(this: unknown) {
  return (tree: Root) => {
    rewriteMarkdownTree<Content | RootContent>(tree, transformImageWidthChildren);
    rewriteMarkdownTree<Content | RootContent | UnderlinePhrasingContent>(tree, transformUnderlineChildren);
  };
}

type TreeParent<TNode> = {
  children?: TNode[];
};

function rewriteMarkdownTree<TNode>(
  parent: TreeParent<TNode>,
  rewriteChildren: (children: TNode[]) => TNode[],
) {
  if (!Array.isArray(parent.children)) {
    return;
  }

  parent.children = rewriteChildren(parent.children);

  for (const child of parent.children) {
    if (hasTreeChildren<TNode>(child)) {
      rewriteMarkdownTree(child, rewriteChildren);
    }
  }
}

function hasTreeChildren<TNode>(node: unknown): node is TreeParent<TNode> {
  return Boolean(
    node &&
      typeof node === "object" &&
      "children" in node &&
      Array.isArray((node as TreeParent<TNode>).children),
  );
}
