import {
  mapInlines,
  type Block,
  type Inline,
  type ListBlock,
  type ListItemBlock,
  type MentionTarget,
  type Text,
} from "@/document";
import { parseFragment, serializeBlocks, serializeFragment } from "@/markdown";
import { createElement, type ReactNode } from "react";

type LeafMarkdownProps = {
  value: string;
  onDoubleClick?: () => void;
  mentionTargets?: readonly MentionTarget[];
};

export function LeafMarkdown({ mentionTargets, onDoubleClick, value }: LeafMarkdownProps) {
  const content = renderMarkdownFragment(value, mentionTargets);

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
    case "heading":
      return createElement("p", { className: "font-semibold" }, ...renderInlines(block.children));
    case "blockquote":
      return createElement(
        "blockquote",
        { className: "grid gap-2.5 m-0 ps-3 border-s-2 border-leaf-border text-leaf-secondary" },
        ...block.children.map(renderBlock),
      );
    case "code":
      return renderPreformatted(block.source);
    case "list":
      return renderList(block);
    default:
      // Blocks without a native rendering show their saved markdown, so no content is hidden.
      return renderPreformatted(serializeBlocks([block], { padTableColumns: true }));
  }
}

function renderPreformatted(text: string): ReactNode {
  return (
    <pre className="m-0 px-2 py-1.5 rounded-md bg-inline-code-bg text-inline-code font-mono text-[0.92em] whitespace-pre-wrap">
      {text}
    </pre>
  );
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
  return mapInlines<ReactNode>(nodes, (node, children) => {
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
        return createElement(
          "a",
          { href: node.url, rel: "noreferrer", target: "_blank" },
          ...(children ?? []),
        );
      default:
        return serializeFragment({ kind: "inlines", inlines: [node] });
    }
  });
}

function renderText(node: Text): ReactNode {
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
