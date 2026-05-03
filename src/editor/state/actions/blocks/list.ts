import {
  createListBlock,
  createParagraphTextBlock,
  rebuildListBlock,
  rebuildListItemBlock,
  type Block,
  type ListItemBlock,
} from "@/document";
import type { EditorStateAction } from "../../types";
import {
  createDescendantPrimaryRegionTarget,
  createRootPrimaryRegionTarget,
} from "../../selection";
import {
  createInsertedListItem,
  resolveListItemPath,
  type ListItemContext,
} from "../../context";

// List action resolvers: splits, indent / dedent, item movement.
// Backspace and forward-delete on a list item are handled by the
// universal boundary-collapse rule and (for top-level first items)
// the block-demotion override, both in `actions/deletion/`.

// Selects the primary region of item at `itemIndex` within `parentIndices`.
function selectItem(
  rootIndex: number,
  parentIndices: number[],
  itemIndex: number,
  offset: number | "end" = 0,
) {
  return createDescendantPrimaryRegionTarget(rootIndex, [...parentIndices, itemIndex, 0], offset);
}

export function resolveListItemSplit(
  context: ListItemContext,
  offset: number,
): EditorStateAction | null {
  const text = context.region.text;
  const currentItem = context.item;
  const nextChecked = typeof currentItem.checked === "boolean" ? false : currentItem.checked;

  if (offset === 0) {
    const insertedItem = createInsertedListItem("", nextChecked, currentItem.spread);

    return {
      kind: "replace-block",
      block: rebuildListBlock(context.list, [
        ...context.list.items.slice(0, context.itemIndex),
        insertedItem,
        currentItem,
        ...context.list.items.slice(context.itemIndex + 1),
      ]),
      blockId: context.list.id,
      listItemInsertedPath: resolveInsertedItemPath(insertedItem, context.rootIndex, [
        ...context.listChildIndices,
        context.itemIndex,
      ]),
      selection: selectItem(context.rootIndex, context.listChildIndices, context.itemIndex),
    };
  }

  if (offset === text.length) {
    const insertedItem = createInsertedListItem("", nextChecked, currentItem.spread);

    return {
      kind: "replace-block",
      block: rebuildListBlock(context.list, [
        ...context.list.items.slice(0, context.itemIndex + 1),
        insertedItem,
        ...context.list.items.slice(context.itemIndex + 1),
      ]),
      blockId: context.list.id,
      listItemInsertedPath: resolveInsertedItemPath(insertedItem, context.rootIndex, [
        ...context.listChildIndices,
        context.itemIndex + 1,
      ]),
      selection: selectItem(context.rootIndex, context.listChildIndices, context.itemIndex + 1),
    };
  }

  const beforeText = text.slice(0, offset);
  const afterText = text.slice(offset);
  const nextItem = createInsertedListItem(afterText, nextChecked, currentItem.spread);
  const updatedCurrentItem = rebuildListItemBlock(currentItem, [
    createParagraphTextBlock({
      text: beforeText,
    }),
  ]);

  return {
    kind: "replace-block",
    block: rebuildListBlock(context.list, [
      ...context.list.items.slice(0, context.itemIndex),
      updatedCurrentItem,
      nextItem,
      ...context.list.items.slice(context.itemIndex + 1),
    ]),
    blockId: context.list.id,
    listItemInsertedPath: resolveInsertedItemPath(nextItem, context.rootIndex, [
      ...context.listChildIndices,
      context.itemIndex + 1,
    ]),
    selection: selectItem(context.rootIndex, context.listChildIndices, context.itemIndex + 1),
  };
}

export function resolveStructuralListBlockSplit(
  context: ListItemContext,
  offset: number,
): EditorStateAction | null {
  if (offset !== 0 || context.region.text.length !== 0) {
    return resolveListItemSplit(context, offset);
  }

  if (
    context.parentItem &&
    context.parentItemIndex !== null &&
    context.parentItemChildIndices &&
    context.parentList &&
    context.parentListChildIndices
  ) {
    return liftEmptyNestedListItem(context);
  }

  const beforeItems = context.list.items.slice(0, context.itemIndex);
  const afterItems = context.list.items.slice(context.itemIndex + 1);
  const replacementBlocks: Block[] = [];

  if (beforeItems.length > 0) {
    replacementBlocks.push(rebuildListBlock(context.list, beforeItems));
  }

  replacementBlocks.push(
    createParagraphTextBlock({
      text: "",
    }),
  );

  if (afterItems.length > 0) {
    replacementBlocks.push(rebuildListBlock(context.list, afterItems));
  }

  return {
    kind: "splice-blocks",
    blocks: replacementBlocks,
    rootIndex: context.rootIndex,
    selection: createRootPrimaryRegionTarget(context.rootIndex + (beforeItems.length > 0 ? 1 : 0)),
  };
}

export function resolveListItemIndent(context: ListItemContext): EditorStateAction | null {
  if (context.itemIndex === 0) {
    return null;
  }

  const previousItem = context.list.items[context.itemIndex - 1];

  if (!previousItem) {
    return null;
  }

  const nextPreviousItem = appendNestedListItem(previousItem, context.item, context);

  return {
    kind: "replace-block",
    block: rebuildListBlock(
      context.list,
      context.list.items.flatMap((child, index) => {
        if (index === context.itemIndex - 1) {
          return [nextPreviousItem.item];
        }

        if (index === context.itemIndex) {
          return [];
        }

        return [child];
      }),
    ),
    blockId: context.list.id,
    selection: createDescendantPrimaryRegionTarget(
      context.rootIndex,
      nextPreviousItem.regionChildIndices,
    ),
  };
}

export function resolveListItemDedent(context: ListItemContext): EditorStateAction | null {
  return buildLiftedListAction(context, () => ({ insertedItem: context.item }));
}

export function resolveListItemMove(
  context: ListItemContext,
  direction: -1 | 1,
): EditorStateAction | null {
  const targetIndex = context.itemIndex + direction;

  if (targetIndex < 0 || targetIndex >= context.list.items.length) {
    return null;
  }

  const nextChildren = [...context.list.items];
  const [item] = nextChildren.splice(context.itemIndex, 1);

  if (!item) {
    return null;
  }

  nextChildren.splice(targetIndex, 0, item);

  return {
    kind: "replace-block",
    block: rebuildListBlock(context.list, nextChildren),
    blockId: context.list.id,
    selection: selectItem(context.rootIndex, context.listChildIndices, targetIndex),
  };
}

function liftEmptyNestedListItem(context: ListItemContext): EditorStateAction | null {
  return buildLiftedListAction(context, (parentItem) => {
    const liftedChecked =
      typeof parentItem.checked === "boolean" ? false : parentItem.checked;
    return {
      insertedItem: createInsertedListItem("", liftedChecked, parentItem.spread),
      trackInsertedPath: true,
    };
  });
}

// Lifts the current item out of its nested list and inserts a new
// item alongside its (now-shrunken) parent in the grandparent list.
// Shared between `resolveListItemDedent` (which moves the existing
// item up a level) and `liftEmptyNestedListItem` (which replaces it
// with a fresh empty item carrying the parent's checked/spread
// state). The factory builds the inserted item from the validated
// parent item, so callers don't need to repeat the parent-fields
// null check.
function buildLiftedListAction(
  context: ListItemContext,
  buildInsertion: (parentItem: ListItemBlock) => {
    insertedItem: ListItemBlock;
    trackInsertedPath?: boolean;
  },
): EditorStateAction | null {
  if (
    !context.parentItem ||
    context.parentItemIndex === null ||
    !context.parentItemChildIndices ||
    !context.parentList ||
    !context.parentListChildIndices
  ) {
    return null;
  }

  const remainingNestedChildren = context.list.items.filter(
    (_, index) => index !== context.itemIndex,
  );
  const updatedParentChildren = context.parentItem.children.flatMap((child) => {
    if (child.type !== "list" || child.id !== context.list.id) {
      return [child];
    }

    if (remainingNestedChildren.length === 0) {
      return [];
    }

    return [rebuildListBlock(context.list, remainingNestedChildren)];
  });
  const updatedParentItem = rebuildListItemBlock(context.parentItem, updatedParentChildren);
  const { insertedItem, trackInsertedPath = false } = buildInsertion(context.parentItem);
  const insertedItemPath = trackInsertedPath
    ? resolveInsertedItemPath(insertedItem, context.rootIndex, [
        ...context.parentListChildIndices,
        context.parentItemIndex + 1,
      ])
    : undefined;

  return {
    kind: "replace-block",
    block: rebuildListBlock(context.parentList, [
      ...context.parentList.items.slice(0, context.parentItemIndex),
      updatedParentItem,
      insertedItem,
      ...context.parentList.items.slice(context.parentItemIndex + 1),
    ]),
    blockId: context.parentList.id,
    listItemInsertedPath: insertedItemPath,
    selection: selectItem(
      context.rootIndex,
      context.parentListChildIndices,
      context.parentItemIndex + 1,
    ),
  };
}

function resolveInsertedItemPath(
  item: ListItemBlock,
  rootIndex: number,
  childIndices: number[],
): string | undefined {
  return typeof item.checked === "boolean"
    ? undefined
    : resolveListItemPath(rootIndex, childIndices);
}

function appendNestedListItem(
  previousItem: ListItemBlock,
  item: ListItemBlock,
  context: ListItemContext,
): { item: ListItemBlock; regionChildIndices: number[] } {
  const existingNestedListIndex = previousItem.children.findIndex(
    (child) =>
      child.type === "list" &&
      child.ordered === context.list.ordered &&
      child.start === context.list.start,
  );

  if (existingNestedListIndex >= 0) {
    const existingNestedList = previousItem.children[existingNestedListIndex];

    if (!existingNestedList || existingNestedList.type !== "list") {
      return {
        item: previousItem,
        regionChildIndices: [...context.listChildIndices, context.itemIndex - 1, 0],
      };
    }

    return {
      item: rebuildListItemBlock(
        previousItem,
        previousItem.children.map((child, index) =>
          index === existingNestedListIndex
            ? rebuildListBlock(existingNestedList, [...existingNestedList.items, item])
            : child,
        ),
      ),
      regionChildIndices: [
        ...context.listChildIndices,
        context.itemIndex - 1,
        existingNestedListIndex,
        existingNestedList.items.length,
        0,
      ],
    };
  }

  const nestedList = createListBlock({
    items: [item],
    ordered: context.list.ordered,
    spread: context.list.spread,
    start: context.list.start,
  });

  return {
    item: rebuildListItemBlock(previousItem, [...previousItem.children, nestedList]),
    regionChildIndices: [
      ...context.listChildIndices,
      context.itemIndex - 1,
      previousItem.children.length,
      0,
      0,
    ],
  };
}
