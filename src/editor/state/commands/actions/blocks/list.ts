import {
  createListBlock,
  createListItemBlock,
  createParagraphBlock,
  createParagraphTextBlock,
  rebuildListBlock,
  rebuildListItemBlock,
  rebuildTextBlock,
  type Block,
  type Inline,
  type ListBlock,
  type ListItemBlock,
} from "@/document";
import { effect } from "../../../effects";
import { target } from "../../../selection";
import type { EditorStateAction } from "../../../types";
import type { ListItemContext } from "../../context";
import { sliceInlineChildren } from "../inlines/shared";
import { isCompatibleListBlock } from "../shared";
import { insertAt, moveItem, spliceAt } from "./shared";

// List block actions for Enter, Tab / Shift-Tab, and explicit item moves.
// Delete behavior stays with the universal boundary-collapse rules and the
// top-level list demotion override in `actions/deletion/`.
//
// Public resolvers in this file should read as: guard in list language,
// rebuild in list language, declare selection/effects by semantic intent.
// Array surgery and editor action envelopes stay in local helpers.

type ListActionIntent = {
  // The list item to place selection in
  // after performing the list action
  selectedItem: ListItemBlock;

  // The list item inserted by the list action, if any
  insertedItem?: ListItemBlock;
};

export function resolveListItemLineBreak(
  context: ListItemContext,
  offset: number,
): EditorStateAction | null {
  if (!atStartOfEmptyItem(context, offset)) {
    return splitListItem(context, offset);
  }

  if (context.parent) {
    return liftItemToParentList(context, createSiblingListItem(context.parent.item, []));
  }

  return exitList(context);
}

export function resolveListItemIndent(context: ListItemContext): EditorStateAction | null {
  // You can't indent the first item in a list
  if (context.itemIndex === 0) return null;

  // Grab the previous sibling and produce a new list
  // where the target item starts a new list beneath it
  const previousItem = context.list.items[context.itemIndex - 1];
  const newList = indentItemUnderPreviousSibling(context, previousItem);

  return replaceListItems(context.list, context.listPath, newList, {
    selectedItem: context.item,
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

  return items
    ? replaceListItems(context.list, context.listPath, items, { selectedItem: context.item })
    : null;
}

function splitListItem(context: ListItemContext, offset: number): EditorStateAction | null {
  if (offset === 0 && context.childIndex === 0) {
    return insertEmptyListItem(context);
  }

  return splitListItemTextAtOffset(context, offset);
}

function insertEmptyListItem(context: ListItemContext): EditorStateAction {
  const insertedItem = createSiblingListItem(context.item, []);

  return replaceListItems(
    context.list,
    context.listPath,
    insertAt(context.list.items, context.itemIndex, insertedItem),
    // The caret stays with the text, which moves down below the new item.
    { insertedItem, selectedItem: context.item },
  );
}

// The item keeps everything before the caret and the new sibling takes the
// rest, so Enter at the start of a later paragraph moves it whole. Text nested
// deeper than the item's own children (childIndex -1) can't split the item.
function splitListItemTextAtOffset(
  context: ListItemContext,
  offset: number,
): EditorStateAction | null {
  const { childIndex, item } = context;
  const paragraph = item.children[childIndex];

  if (paragraph?.type !== "paragraph") {
    return null;
  }

  const updatedItem = rebuildListItemBlock(item, [
    ...item.children.slice(0, childIndex),
    ...(offset > 0
      ? [rebuildTextBlock(paragraph, sliceInlineChildren(paragraph.children, 0, offset))]
      : []),
  ]);
  const insertedItem = createSiblingListItem(
    item,
    sliceInlineChildren(paragraph.children, offset),
    item.children.slice(childIndex + 1),
  );
  const items = spliceAt(context.list.items, context.itemIndex, 1, [updatedItem, insertedItem]);

  return replaceListItems(context.list, context.listPath, items, {
    insertedItem,
    selectedItem: insertedItem,
  });
}

function indentItemUnderPreviousSibling(
  context: ListItemContext,
  previousItem: ListItemBlock,
): ListItemBlock[] {
  return spliceAt(context.list.items, context.itemIndex - 1, 2, [
    appendNestedListItems(previousItem, [context.item], context.list),
  ]);
}

function liftItemToParentList(
  context: ListItemContext,
  liftedItem: ListItemBlock,
): EditorStateAction | null {
  if (!context.parent) {
    return null;
  }

  // The parent keeps what comes before the lifted item, and the lifted item
  // adopts what follows it, so lifting never reorders content.
  const parentItem = context.parent.item;
  const listIndex = parentItem.children.indexOf(context.list);
  const itemsBefore = context.list.items.slice(0, context.itemIndex);
  const itemsAfter = context.list.items.slice(context.itemIndex + 1);
  const parentTail = parentItem.children.slice(listIndex + 1);
  const updatedParentItem = rebuildListItemBlock(parentItem, [
    ...parentItem.children.slice(0, listIndex),
    ...(itemsBefore.length > 0 ? [rebuildListBlock(context.list, itemsBefore)] : []),
  ]);
  const adoptingItem =
    itemsAfter.length > 0
      ? appendNestedListItems(liftedItem, itemsAfter, context.list)
      : liftedItem;
  const updatedLiftedItem = createListItemBlock({
    checked: adoptingItem.checked,
    children: [...adoptingItem.children, ...parentTail],
    // A paragraph after a nested list needs a blank line, or it reads as
    // part of that list.
    compact: adoptingItem.compact && parentTail.length === 0,
  });
  const parentItems = spliceAt(context.parent.list.items, context.parent.itemIndex, 1, [
    updatedParentItem,
    updatedLiftedItem,
  ]);

  return replaceListItems(context.parent.list, context.parent.listPath, parentItems, {
    // Dedent lifts the item itself, while Enter lifts a fresh sibling in its place.
    insertedItem: liftedItem === context.item ? undefined : updatedLiftedItem,
    selectedItem: updatedLiftedItem,
  });
}

function exitList(context: ListItemContext): EditorStateAction {
  const paragraph = createParagraphTextBlock("");

  return {
    kind: "splice-blocks",
    blocks: replaceItemWithRootBlocks(context.list, context.itemIndex, [paragraph]),
    rootIndex: context.rootIndex,
    selection: target.block(paragraph),
  };
}

function replaceListItems(
  list: ListBlock,
  listPath: string,
  items: ListItemBlock[],
  intent: ListActionIntent,
): EditorStateAction {
  return {
    kind: "replace-block",
    blockPath: listPath,
    block: rebuildListBlock(list, items),
    selection: target.block(intent.selectedItem),
    effect: intent.insertedItem && effect.listItemInserted(intent.insertedItem),
  };
}

function createSiblingListItem(item: ListItemBlock, children: Inline[], rest: Block[] = []) {
  return createListItemBlock({
    checked: isTaskItem(item) ? false : item.checked,
    children: [createParagraphBlock(children), ...rest],
    compact: item.compact,
  });
}

function atStartOfEmptyItem(context: ListItemContext, offset: number) {
  return offset === 0 && context.text.length === 0 && context.item.children.length === 1;
}

function isTaskItem(item: ListItemBlock) {
  return typeof item.checked === "boolean";
}

export function replaceItemWithRootBlocks(
  list: ListBlock,
  itemIndex: number,
  replacement: Block[],
): Block[] {
  const beforeItems = list.items.slice(0, itemIndex);
  const afterItems = list.items.slice(itemIndex + 1);
  const blocks: Block[] = [];

  if (beforeItems.length > 0) {
    blocks.push(rebuildListBlock(list, beforeItems));
  }

  blocks.push(...replacement);

  // The tail continues the list's count, as GitHub and Docs number it.
  if (afterItems.length > 0) {
    blocks.push(
      createListBlock({
        compact: list.compact,
        items: afterItems,
        ordered: list.ordered,
        start: (list.start ?? 1) + itemIndex,
      }),
    );
  }

  return blocks;
}

// A new nested list starts at 1. Like the parser, a list is tight only when no
// blank line separates or sits inside its items, and a tight item can't hold a
// loose list.
function appendNestedListItems(
  previousItem: ListItemBlock,
  items: ListItemBlock[],
  list: ListBlock,
): ListItemBlock {
  const lastChild = previousItem.children.at(-1);
  // Merging into an earlier nested list would move the items above whatever follows it.
  const nested = lastChild && isCompatibleListBlock(lastChild, list) ? lastChild : null;
  const nestedList = createListBlock({
    compact:
      (nested?.compact ?? (items.length === 1 || list.compact)) &&
      items.every((item) => item.compact),
    items: [...(nested?.items ?? []), ...items],
    ordered: list.ordered,
    start: nested?.start,
  });

  return createListItemBlock({
    checked: previousItem.checked,
    children: [
      ...(nested ? previousItem.children.slice(0, -1) : previousItem.children),
      nestedList,
    ],
    compact: previousItem.compact && nestedList.compact,
  });
}
