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

type LeafMarkdownProps = {
  value: string;
  onDoubleClick?: () => void;
  mentionTargets?: readonly MentionTarget[];
};

export function LeafMarkdown({ mentionTargets, onDoubleClick, value }: LeafMarkdownProps) {
  const content = useMemo(
    () => renderMarkdownFragment(value, mentionTargets),
    [mentionTargets, value],
  );

  return createElement(
    "div",
    {
      className:
        "grid gap-2.5 wrap-anywhere [&_:is(ul,ol)]:grid [&_:is(ul,ol)]:gap-1 [&_:is(ul,ol)]:m-0 [&_:is(ul,ol)]:ps-7 [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ps-0.5 [&_a]:text-leaf-accent [&_a]:underline [&_a]:underline-offset-2",
      onDoubleClick,
    },
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
    {
      className: "grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 items-start -ms-6 list-none",
    },
    createElement("input", {
      checked: block.checked,
      className: "m-0 mt-0.5",
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
        return (
          <span className="px-[0.3em] py-[0.05em] rounded-[0.4em] bg-mention-bg text-mention font-medium whitespace-nowrap">
            @{node.name}
          </span>
        );
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
        return (
          <code className="px-[0.24em] py-[0.05em] bg-inline-code-bg text-inline-code font-mono text-[0.92em]">
            {current}
          </code>
        );
    }
  }, node.text);
}
