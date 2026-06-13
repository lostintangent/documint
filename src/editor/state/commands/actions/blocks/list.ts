import {
  createListBlock,
  createParagraphTextBlock,
  rebuildListBlock,
  rebuildListItemBlock,
  type Block,
  type ListBlock,
  type ListItemBlock,
} from "@/document";
import { effect } from "../../../effects";
import { target } from "../../../selection";
import type { EditorStateAction } from "../../../types";
import {
  createInsertedListItem,
  replaceListItemLeadingParagraphText,
  type ListItemContext,
} from "../../context";
import { isCompatibleListBlock } from "../shared";
import { insertAt, moveItem, removeAt, replaceAt } from "./shared";

// List block actions for Enter, Tab / Shift-Tab, and explicit item moves.
// Delete behavior stays with the universal boundary-collapse rules and the
// top-level list demotion override in `actions/deletion/`.
//
// Public resolvers in this file should read as: guard in list language,
// rebuild in list language, declare caret/effects by semantic intent.
// Array surgery and editor action envelopes stay in local helpers.

type ListActionIntent = {
  caret: ListItemBlock;
  inserted?: ListItemBlock;
};

export function resolveListItemLineBreak(
  context: ListItemContext,
  offset: number,
): EditorStateAction | null {
  if (!atStartOfEmptyItem(context, offset)) {
    return splitListItem(context, offset);
  }

  if (context.parent) {
    const insertedItem = createSiblingListItem(context.parent.item, "");
    return liftItemToParentList(context, insertedItem, { inserted: insertedItem });
  }

  return exitList(context);
}

export function resolveListItemIndent(context: ListItemContext): EditorStateAction | null {
  if (context.itemIndex === 0) {
    return null;
  }

  const previousItem = context.list.items[context.itemIndex - 1];

  if (!previousItem) {
    return null;
  }

  return replaceListItems(context.list, indentItemUnderPreviousSibling(context, previousItem), {
    caret: context.item,
  });
}

export function resolveListItemDedent(context: ListItemContext): EditorStateAction | null {
  return liftItemToParentList(context, context.item);
}

export function resolveListItemMove(
  context: ListItemContext,
  direction: -1 | 1,
): EditorStateAction | null {
  const items = moveItem(context.list.items, context.itemIndex, context.itemIndex + direction);

  return items ? replaceListItems(context.list, items, { caret: context.item }) : null;
}

function splitListItem(context: ListItemContext, offset: number): EditorStateAction | null {
  if (offset === 0) {
    return insertEmptyListItem(context, context.itemIndex);
  }

  if (offset === context.region.text.length) {
    return insertEmptyListItem(context, context.itemIndex + 1);
  }

  return splitListItemTextAtOffset(context, offset);
}

function insertEmptyListItem(context: ListItemContext, insertIndex: number): EditorStateAction {
  const insertedItem = createSiblingListItem(context.item, "");

  return replaceListItems(context.list, insertAt(context.list.items, insertIndex, insertedItem), {
    caret: insertedItem,
    inserted: insertedItem,
  });
}

function splitListItemTextAtOffset(
  context: ListItemContext,
  offset: number,
): EditorStateAction | null {
  const text = context.region.text;
  const updatedItem = replaceListItemLeadingParagraphText(context.item, text.slice(0, offset));

  if (!updatedItem) {
    return null;
  }

  const insertedItem = createSiblingListItem(context.item, text.slice(offset));
  const items = insertAt(
    replaceAt(context.list.items, context.itemIndex, updatedItem),
    context.itemIndex + 1,
    insertedItem,
  );

  return replaceListItems(context.list, items, {
    caret: insertedItem,
    inserted: insertedItem,
  });
}

function indentItemUnderPreviousSibling(
  context: ListItemContext,
  previousItem: ListItemBlock,
): ListItemBlock[] {
  const previousItemWithNestedItem = appendNestedListItem(
    previousItem,
    context.item,
    context.list,
  );
  const itemsWithNestedItem = replaceAt(
    context.list.items,
    context.itemIndex - 1,
    previousItemWithNestedItem,
  );

  return removeAt(itemsWithNestedItem, context.itemIndex);
}

function liftItemToParentList(
  context: ListItemContext,
  liftedItem: ListItemBlock,
  intent: { inserted?: ListItemBlock } = {},
): EditorStateAction | null {
  if (!context.parent) {
    return null;
  }

  const remainingNestedItems = removeAt(context.list.items, context.itemIndex);
  const updatedParentItem = rebuildListItemBlock(
    context.parent.item,
    context.parent.item.children.flatMap((child) => {
      if (child.type !== "list" || child.id !== context.list.id) {
        return [child];
      }

      return remainingNestedItems.length > 0
        ? [rebuildListBlock(context.list, remainingNestedItems)]
        : [];
    }),
  );
  const parentItems = insertAt(
    replaceAt(context.parent.list.items, context.parent.itemIndex, updatedParentItem),
    context.parent.itemIndex + 1,
    liftedItem,
  );

  return replaceListItems(context.parent.list, parentItems, {
    caret: liftedItem,
    inserted: intent.inserted,
  });
}

function exitList(context: ListItemContext): EditorStateAction {
  const paragraph = createParagraphTextBlock("");

  return {
    kind: "splice-blocks",
    blocks: replaceItemWithRootBlock(context.list, context.itemIndex, paragraph),
    rootIndex: context.rootIndex,
    selection: target.block(paragraph),
  };
}

function replaceListItems(
  list: ListBlock,
  items: ListItemBlock[],
  intent: ListActionIntent,
): EditorStateAction {
  return {
    kind: "replace-block",
    block: rebuildListBlock(list, items),
    blockId: list.id,
    effect: intent.inserted ? insertedListItemEffect(intent.inserted) : undefined,
    selection: target.block(intent.caret),
  };
}

function insertedListItemEffect(item: ListItemBlock) {
  return isTaskItem(item) ? undefined : effect.listItemInserted(item);
}

function createSiblingListItem(item: ListItemBlock, text: string) {
  return createInsertedListItem(text, isTaskItem(item) ? false : item.checked, item.compact);
}

function atStartOfEmptyItem(context: ListItemContext, offset: number) {
  return offset === 0 && context.region.text.length === 0;
}

function isTaskItem(item: ListItemBlock) {
  return typeof item.checked === "boolean";
}

function replaceItemWithRootBlock(list: ListBlock, itemIndex: number, block: Block): Block[] {
  const beforeItems = list.items.slice(0, itemIndex);
  const afterItems = list.items.slice(itemIndex + 1);
  const blocks: Block[] = [];

  if (beforeItems.length > 0) {
    blocks.push(rebuildListBlock(list, beforeItems));
  }

  blocks.push(block);

  if (afterItems.length > 0) {
    blocks.push(rebuildListBlock(list, afterItems));
  }

  return blocks;
}

function appendNestedListItem(
  previousItem: ListItemBlock,
  item: ListItemBlock,
  list: ListBlock,
): ListItemBlock {
  const existingNestedList = previousItem.children.find((child): child is ListBlock =>
    isCompatibleListBlock(child, list),
  );

  if (existingNestedList) {
    return rebuildListItemBlock(
      previousItem,
      previousItem.children.map((child) =>
        child === existingNestedList
          ? rebuildListBlock(existingNestedList, [...existingNestedList.items, item])
          : child,
      ),
    );
  }

  return rebuildListItemBlock(previousItem, [
    ...previousItem.children,
    createListBlock({
      compact: list.compact,
      items: [item],
      ordered: list.ordered,
      start: list.start,
    }),
  ]);
}
