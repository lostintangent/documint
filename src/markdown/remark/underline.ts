import type { Content, PhrasingContent, RootContent } from "mdast";

export type UnderlinePhrasingContent = {
  children: UnderlineContent[];
  type: "underline";
};

type UnderlineContent = PhrasingContent | UnderlinePhrasingContent;

export function serializeUnderline(children: PhrasingContent[]): PhrasingContent[] {
  return [
    {
      type: "html",
      value: "<ins>",
    },
    ...children,
    {
      type: "html",
      value: "</ins>",
    },
  ];
}

export function transformUnderlineChildren(
  children: Array<RootContent | Content | UnderlinePhrasingContent>,
) {
  const transformed: Array<RootContent | Content | UnderlinePhrasingContent> = [];

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;

    if (isUnderlineOpenHtml(child)) {
      const underlineChildren: UnderlineContent[] = [];
      let closingIndex = index + 1;

      while (closingIndex < children.length) {
        const candidate = children[closingIndex]!;

        if (isUnderlineCloseHtml(candidate)) {
          break;
        }

        if (isPhrasingContent(candidate)) {
          underlineChildren.push(candidate);
          closingIndex += 1;
          continue;
        }

        break;
      }

      if (closingIndex < children.length && isUnderlineCloseHtml(children[closingIndex]!)) {
        transformed.push({
          children: underlineChildren,
          type: "underline",
        });
        index = closingIndex;
        continue;
      }
    }

    transformed.push(child);
  }

  return transformed;
}

function isPhrasingContent(
  node: RootContent | Content | UnderlinePhrasingContent,
): node is UnderlineContent {
  switch (node.type) {
    case "break":
    case "delete":
    case "emphasis":
    case "html":
    case "image":
    case "inlineCode":
    case "link":
    case "strong":
    case "text":
    case "textDirective":
    case "underline":
      return true;
    default:
      return false;
  }
}

function isUnderlineOpenHtml(node: RootContent | Content | UnderlinePhrasingContent) {
  return node.type === "html" && node.value.trim() === "<ins>";
}

function isUnderlineCloseHtml(node: RootContent | Content | UnderlinePhrasingContent) {
  return node.type === "html" && node.value.trim() === "</ins>";
}
