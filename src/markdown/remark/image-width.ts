import { defaultHandlers } from "mdast-util-to-markdown";
import type { Info, State } from "mdast-util-to-markdown";
import type { Content, Image, Parents, RootContent, Text } from "mdast";

export type MarkdownImageWithWidth = Image & {
  data?: {
    width?: number;
  };
};

export function getMarkdownImageWidth(node: Image) {
  const image = node as MarkdownImageWithWidth;
  const width = image.data?.width;

  return typeof width === "number" && Number.isFinite(width) && width > 0 ? width : null;
}

export function serializeImageWithWidth(
  node: Image,
  parent: Parents | undefined,
  state: State,
  info: Info,
) {
  const base = defaultHandlers.image(node, parent, state, info);
  const width = getMarkdownImageWidth(node);

  return width ? `${base}{width=${width}}` : base;
}

export function transformImageWidthChildren(children: Array<RootContent | Content>) {
  const transformed: Array<RootContent | Content> = [];

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const next = children[index + 1];

    if (child.type === "image" && next?.type === "text") {
      const widthMatch = parseWidthAttribute(next);

      if (widthMatch) {
        const image = child as MarkdownImageWithWidth;

        image.data = {
          ...image.data,
          width: widthMatch.width,
        };

        if (widthMatch.remaining.length > 0) {
          transformed.push(child, {
            ...next,
            value: widthMatch.remaining,
          });
        } else {
          transformed.push(child);
        }

        index += 1;
        continue;
      }
    }

    transformed.push(child);
  }

  return transformed;
}

function parseWidthAttribute(node: Text) {
  const match = /^\{width=([1-9]\d*)\}/.exec(node.value);

  if (!match) {
    return null;
  }

  return {
    remaining: node.value.slice(match[0].length),
    width: Number(match[1]),
  };
}
