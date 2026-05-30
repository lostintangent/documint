import {
  mapInlines,
  type Block,
  type Inline,
  type Link,
  type ListBlock,
  type ListItemBlock,
  type MentionTarget,
  type Text,
} from "@/document";
import { parseFragment } from "@/markdown";
import { createElement, useMemo, type ReactNode } from "react";

type MarkdownOutputProps = {
  value: string;
  onDoubleClick?: () => void;
  mentionTargets?: readonly MentionTarget[];
};

export function MarkdownOutput({ mentionTargets, onDoubleClick, value }: MarkdownOutputProps) {
  const content = useMemo(
    () => renderMarkdownFragment(value, mentionTargets),
    [mentionTargets, value],
  );

  return createElement(
    "div",
    { className: "documint-markdown-output", onDoubleClick },
    ...(Array.isArray(content) ? content : [content]),
  );
}

function renderMarkdownFragment(
  value: string,
  mentionTargets: readonly MentionTarget[] | undefined,
): ReactNode {
  const fragment = parseFragment(value, { mentionTargets });

  switch (fragment.kind) {
    case "text":
      return <p>{fragment.text}</p>;
    case "inlines":
      return createElement("p", null, ...renderInlines(fragment.inlines));
    case "blocks":
      return fragment.blocks.map(renderBlock);
  }
}

function renderBlock(block: Block): ReactNode {
  switch (block.type) {
    case "paragraph":
      return createElement("p", null, ...renderInlines(block.children));
    case "list":
      return renderList(block);
    default:
      return null;
  }
}

function renderList(block: ListBlock): ReactNode {
  const children = block.items.map(renderListItem);
  const props = block.ordered && block.start !== null ? { start: block.start } : null;

  return createElement(block.ordered ? "ol" : "ul", props, ...children);
}

function renderListItem(block: ListItemBlock): ReactNode {
  const children = block.children.map(renderBlock);

  if (block.checked === null) {
    return createElement("li", null, ...children);
  }

  return createElement(
    "li",
    { className: "documint-task-list-item" },
    createElement("input", {
      checked: block.checked,
      disabled: true,
      readOnly: true,
      type: "checkbox",
    }),
    ...children,
  );
}

function renderInlines(nodes: readonly Inline[]): ReactNode[] {
  return mapInlines<ReactNode>(nodes, (node, _context, children) => {
    switch (node.type) {
      case "text":
        return renderText(node);
      case "lineBreak":
        return <br />;
      case "mention":
        return <span className="documint-mention">@{node.name}</span>;
      case "link":
        return renderLink(node, children);
      default:
        return null;
    }
  });
}

function renderLink(node: Link, children: ReactNode[] | null): ReactNode {
  return createElement(
    "a",
    { href: node.url, rel: "noreferrer", target: "_blank" },
    ...(children ?? []),
  );
}

function renderText(node: Text): ReactNode {
  if (node.marks.length === 0) {
    return node.text;
  }

  return node.marks.reduce<ReactNode>((current, mark) => {
    switch (mark) {
      case "bold":
        return <strong>{current}</strong>;
      case "italic":
        return <em>{current}</em>;
      case "strikethrough":
        return <s>{current}</s>;
      case "underline":
        return <u>{current}</u>;
      case "superscript":
        return <sup>{current}</sup>;
      case "code":
        return <code className="documint-markdown-inline-code">{current}</code>;
    }
  }, node.text);
}
