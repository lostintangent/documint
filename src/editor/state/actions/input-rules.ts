import {
  createBlockquoteBlock,
  createDividerBlock,
  createHeadingTextBlock,
  createListBlock,
  createListItemBlock,
  createParagraphTextBlock,
  rebuildListBlock,
  type HeadingBlock,
} from "@/document";
import type { DocumentIndex } from "../index/types";
import type { EditorStateAction } from "../types";
import {
  createDescendantPrimaryRegionTarget,
  createRootPrimaryRegionTarget,
  normalizeSelection,
  type EditorSelection,
} from "../selection";
import { replaceListItemLeadingParagraphText, resolveListItemContext } from "../context";
import { findRootIndex, resolveRootTextBlockContext } from "../context";

// Text input rule detection: recognizes markdown-like patterns (headings, lists,
// blockquotes, dividers) and produces the corresponding action.

export function resolveTextInputRule(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  text: string,
): EditorStateAction | null {
  const region = documentIndex.regionIndex.get(selection.anchor.regionId);

  if (!region) {
    return null;
  }

  const normalized = normalizeSelection(documentIndex, selection);
  const prospectiveText =
    normalized.start.regionId === normalized.end.regionId && normalized.start.regionId === region.id
      ? region.text.slice(0, normalized.start.offset) +
        text +
        region.text.slice(normalized.end.offset)
      : text;

  return (
    applyListTransformInputRule(documentIndex, selection, region.id, prospectiveText) ??
    applyBlockTransformInputRule(documentIndex, selection, region.id, prospectiveText) ??
    applyListCreationTextInputRules(documentIndex, selection, region.id, prospectiveText) ??
    applyBlockCreationTextInputRules(documentIndex, selection, region.id, prospectiveText) ??
    applyThematicBreakTextInputRule(
      documentIndex,
      region.blockId,
      region.rootIndex,
      prospectiveText,
    ) ?? {
      kind: "splice-text",
      selection,
      text,
    }
  );
}

function applyListTransformInputRule(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  regionId: string,
  prospectiveText: string,
): EditorStateAction | null {
  const context = resolveListItemContext(documentIndex, selection);
  const transformed = parseListTransformInput(prospectiveText);

  if (!context || !transformed || context.region.id !== regionId) {
    return null;
  }

  const nextItem = replaceListItemLeadingParagraphText(context.item, transformed.text);

  if (!nextItem) {
    return null;
  }

  return {
    kind: "replace-block",
    block: rebuildListBlock(
      context.list,
      context.list.items.map((item, index) => (index === context.itemIndex ? nextItem : item)),
      {
        ordered: transformed.ordered,
        start: transformed.ordered ? 1 : null,
      },
    ),
    blockId: context.list.id,
    selection: createDescendantPrimaryRegionTarget(context.rootIndex, [
      ...context.listChildIndices,
      context.itemIndex,
      0,
    ]),
  };
}

function applyListCreationTextInputRules(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  regionId: string,
  prospectiveText: string,
): EditorStateAction | null {
  if (!isRootParagraphInputRuleTarget(documentIndex, selection, regionId)) {
    return null;
  }

  const taskMatch = /^\s*([-+*])\s\[( |x|X)\]\s$/.exec(prospectiveText);

  if (taskMatch) {
    const checked = prospectiveText.toLowerCase().includes("[x]");

    return replaceRootParagraphWithList(documentIndex, selection, {
      checked,
      ordered: false,
      start: null,
    });
  }

  if (/^\s*[-+*]\s$/.test(prospectiveText)) {
    return replaceRootParagraphWithList(documentIndex, selection, {
      checked: null,
      ordered: false,
      start: null,
    });
  }

  const orderedMatch = /^\s*(\d+)\.\s$/.exec(prospectiveText);

  if (orderedMatch) {
    return replaceRootParagraphWithList(documentIndex, selection, {
      checked: null,
      ordered: true,
      start: Number(orderedMatch[1]),
    });
  }

  return null;
}

function applyBlockTransformInputRule(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  regionId: string,
  prospectiveText: string,
): EditorStateAction | null {
  const context = resolveRootTextBlockContext(documentIndex, selection);
  const transformed = parseHeadingTransformInput(prospectiveText);

  if (
    !context ||
    context.region.id !== regionId ||
    context.block.type !== "heading" ||
    !transformed
  ) {
    return null;
  }

  return {
    kind: "splice-blocks",
    blocks: [
      createHeadingTextBlock({
        depth: transformed.depth,
        text: transformed.text,
      }),
    ],
    rootIndex: context.rootIndex,
    selection: createRootPrimaryRegionTarget(context.rootIndex),
  };
}

function applyBlockCreationTextInputRules(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  regionId: string,
  prospectiveText: string,
): EditorStateAction | null {
  return (
    applyHeadingTextInputRule(documentIndex, selection, regionId, prospectiveText) ??
    applyBlockquoteTextInputRule(documentIndex, selection, regionId, prospectiveText)
  );
}

function applyHeadingTextInputRule(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  regionId: string,
  prospectiveText: string,
): EditorStateAction | null {
  if (!isRootParagraphInputRuleTarget(documentIndex, selection, regionId)) {
    return null;
  }

  const headingMatch = /^(#{1,6})\s$/.exec(prospectiveText);

  if (!headingMatch) {
    return null;
  }

  return replaceRootParagraphWithHeading(
    documentIndex,
    selection,
    headingMatch[1].length as HeadingBlock["depth"],
  );
}

function applyBlockquoteTextInputRule(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  regionId: string,
  prospectiveText: string,
): EditorStateAction | null {
  if (
    !isRootParagraphInputRuleTarget(documentIndex, selection, regionId) ||
    !/^>\s$/.test(prospectiveText)
  ) {
    return null;
  }

  return replaceRootParagraphWithBlockquote(documentIndex, selection);
}

function applyThematicBreakTextInputRule(
  documentIndex: DocumentIndex,
  blockId: string,
  rootIndex: number,
  prospectiveText: string,
): EditorStateAction | null {
  if (!/^(?:(?:-\s?){3}|(?:\*\s?){3}|(?:_\s?){3})$/.test(prospectiveText)) {
    return null;
  }

  return {
    kind: "splice-blocks",
    blocks: [
      createDividerBlock(),
      createParagraphTextBlock({
        text: "",
      }),
    ],
    rootIndex: findRootIndex(documentIndex, blockId),
    selection: createRootPrimaryRegionTarget(rootIndex + 1),
  };
}

function replaceRootParagraphWithList(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  options: {
    checked: boolean | null;
    ordered: boolean;
    start: number | null;
  },
): EditorStateAction {
  const rootIndex = findRootIndex(
    documentIndex,
    documentIndex.regionIndex.get(selection.anchor.regionId)!.blockId,
  );

  return {
    kind: "splice-blocks",
    blocks: [
      createListBlock({
        items: [
          createListItemBlock({
            checked: options.checked,
            children: [
              createParagraphTextBlock({
                text: "",
              }),
            ],
            spread: false,
          }),
        ],
        ordered: options.ordered,
        spread: false,
        start: options.start,
      }),
    ],
    rootIndex,
    selection: createDescendantPrimaryRegionTarget(rootIndex, [0, 0]),
  };
}

function replaceRootParagraphWithHeading(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  depth: HeadingBlock["depth"],
): EditorStateAction {
  const rootIndex = findRootIndex(
    documentIndex,
    documentIndex.regionIndex.get(selection.anchor.regionId)!.blockId,
  );

  return {
    kind: "splice-blocks",
    blocks: [
      createHeadingTextBlock({
        depth,
        text: "",
      }),
    ],
    rootIndex,
    selection: createRootPrimaryRegionTarget(rootIndex),
  };
}

function replaceRootParagraphWithBlockquote(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): EditorStateAction {
  const rootIndex = findRootIndex(
    documentIndex,
    documentIndex.regionIndex.get(selection.anchor.regionId)!.blockId,
  );

  return {
    kind: "splice-blocks",
    blocks: [
      createBlockquoteBlock({
        children: [
          createParagraphTextBlock({
            text: "",
          }),
        ],
      }),
    ],
    rootIndex,
    selection: createDescendantPrimaryRegionTarget(rootIndex, [0]),
  };
}

function isRootParagraphInputRuleTarget(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
  regionId: string,
) {
  const context = resolveRootTextBlockContext(documentIndex, selection);

  return context?.region.id === regionId && context.block.type === "paragraph";
}

function parseListTransformInput(prospectiveText: string) {
  const unorderedMatch = /^[-+*]\s(.+)$/.exec(prospectiveText);

  if (unorderedMatch) {
    return {
      ordered: false as const,
      text: unorderedMatch[1]!,
    };
  }

  const orderedMatch = /^\d+\.\s(.+)$/.exec(prospectiveText);

  if (orderedMatch) {
    return {
      ordered: true as const,
      text: orderedMatch[1]!,
    };
  }

  return null;
}

function parseHeadingTransformInput(prospectiveText: string) {
  const headingMatch = /^(#{1,6})\s(.+)$/.exec(prospectiveText);

  return headingMatch
    ? {
        depth: headingMatch[1].length as HeadingBlock["depth"],
        text: headingMatch[2]!,
      }
    : null;
}
