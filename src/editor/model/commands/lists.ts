// Structural list editing commands including split, indent, dedent, task, and
// start-of-item merge or removal behavior.
import {
  createListBlock,
  createListItemBlock,
  createParagraphTextBlock,
  rebuildListBlock,
  rebuildListItemBlock,
  type Block,
  type ListBlock,
  type ListItemBlock,
} from "@/document";
import type { CanvasSelection, EditorSelectionTarget } from "../document-editor";
import type { EditorState } from "../state";

type ListItemContext = {
  container: EditorState["documentEditor"]["regions"][number];
  item: ListItemBlock;
  itemChildIndices: number[];
  itemIndex: number;
  list: ListBlock;
  listChildIndices: number[];
  parentItem: ListItemBlock | null;
  parentItemChildIndices: number[] | null;
  parentItemIndex: number | null;
  parentList: ListBlock | null;
  parentListChildIndices: number[] | null;
  rootIndex: number;
};

type ListHelpers = {
  applyBlockReplacement: (
    state: EditorState,
    targetBlockId: string,
    replacement: Block,
    selection?: CanvasSelection | EditorSelectionTarget,
  ) => EditorState | null;
  extractListContext: (state: EditorState) => ListItemContext | null;
  focusBlockContainer: (state: EditorState, blockId: string) => EditorState;
  focusBlockContainerEnd: (state: EditorState, blockId: string) => EditorState;
  focusDescendantPrimaryRegion: (
    rootIndex: number,
    childIndices: number[],
    offset?: number | "end",
  ) => EditorSelectionTarget;
  focusRootPrimaryRegion: (
    rootIndex: number,
    offset?: number | "end",
  ) => EditorSelectionTarget;
  normalizeSelection: typeof import("../document-editor").normalizeCanvasSelection;
  replaceRootRange: (
    state: EditorState,
    rootIndex: number,
    count: number,
    replacements: Block[],
    selection?: CanvasSelection | EditorSelectionTarget,
  ) => EditorState;
  replaceListItemLeadingParagraphText: (
    item: ListItemBlock,
    text: string,
  ) => ListItemBlock | null;
  resolvePrimaryTextBlockId: (item: ListItemBlock) => string;
};

export type ListOperationResult = {
  insertedListItemPath?: string;
  state: EditorState;
};

export function splitSelectionListItemOperation(state: EditorState, helpers: ListHelpers) {
  const selection = helpers.normalizeSelection(state.documentEditor, state.selection);

  if (
    selection.start.regionId !== selection.end.regionId ||
    selection.start.offset !== selection.end.offset
  ) {
    return null;
  }

  const context = helpers.extractListContext(state);

  if (!context) {
    return null;
  }

  const text = context.container.text;
  const currentItem = context.item;
  const nextChecked = typeof currentItem.checked === "boolean" ? false : currentItem.checked;

  if (selection.start.offset === 0) {
    const insertedItem = createInsertedListItem(
      "",
      nextChecked,
      currentItem.spread,
    );
    const nextChildren = [
      ...context.list.children.slice(0, context.itemIndex),
      insertedItem,
      currentItem,
      ...context.list.children.slice(context.itemIndex + 1),
    ];
    const nextList = rebuildListBlock(context.list, nextChildren);
    const nextState = helpers.applyBlockReplacement(
      state,
      context.list.id,
      nextList,
      helpers.focusDescendantPrimaryRegion(context.rootIndex, [
        ...context.listChildIndices,
        context.itemIndex,
        0,
      ]),
    );

    return createInsertedListItemResult(
      nextState,
      insertedItem,
      context.rootIndex,
      [...context.listChildIndices, context.itemIndex],
    );
  }

  if (selection.start.offset === text.length) {
    const insertedItem = createInsertedListItem(
      "",
      nextChecked,
      currentItem.spread,
    );
    const nextChildren = [
      ...context.list.children.slice(0, context.itemIndex + 1),
      insertedItem,
      ...context.list.children.slice(context.itemIndex + 1),
    ];
    const nextList = rebuildListBlock(context.list, nextChildren);
    const nextState = helpers.applyBlockReplacement(
      state,
      context.list.id,
      nextList,
      helpers.focusDescendantPrimaryRegion(context.rootIndex, [
        ...context.listChildIndices,
        context.itemIndex + 1,
        0,
      ]),
    );

    return createInsertedListItemResult(
      nextState,
      insertedItem,
      context.rootIndex,
      [...context.listChildIndices, context.itemIndex + 1],
    );
  }

  const beforeText = text.slice(0, selection.start.offset);
  const afterText = text.slice(selection.start.offset);
  const nextItem = createInsertedListItem(
    afterText,
    nextChecked,
    currentItem.spread,
  );
  const updatedCurrentItem = rebuildListItemBlock(currentItem, [
    createParagraphTextBlock({
      text: beforeText,
    }),
  ]);
  const nextChildren = [
    ...context.list.children.slice(0, context.itemIndex),
    updatedCurrentItem,
    nextItem,
    ...context.list.children.slice(context.itemIndex + 1),
  ];
  const nextList = rebuildListBlock(context.list, nextChildren);
  const nextState = helpers.applyBlockReplacement(
    state,
    context.list.id,
    nextList,
    helpers.focusDescendantPrimaryRegion(context.rootIndex, [
      ...context.listChildIndices,
      context.itemIndex + 1,
      0,
    ]),
  );

  return createInsertedListItemResult(
    nextState,
    nextItem,
    context.rootIndex,
    [...context.listChildIndices, context.itemIndex + 1],
  );
}

export function splitStructuralListBlockOperation(state: EditorState, helpers: ListHelpers) {
  const context = helpers.extractListContext(state);
  const selection = helpers.normalizeSelection(state.documentEditor, state.selection);

  if (!context || selection.start.regionId !== selection.end.regionId) {
    return null;
  }

  if (selection.start.offset !== 0 || context.container.text.length !== 0) {
    return splitSelectionListItemOperation(state, helpers);
  }

  if (
    context.parentItem &&
    context.parentItemIndex !== null &&
    context.parentItemChildIndices &&
    context.parentList &&
    context.parentListChildIndices
  ) {
    return liftEmptyNestedListItemOperation(state, context, helpers);
  }

  const beforeItems = context.list.children.slice(0, context.itemIndex);
  const afterItems = context.list.children.slice(context.itemIndex + 1);
  const replacementBlocks: Block[] = [];

  if (beforeItems.length > 0) {
    replacementBlocks.push(rebuildListBlock(context.list, beforeItems));
  }

  const paragraph = createParagraphTextBlock({
    text: "",
  });
  replacementBlocks.push(paragraph);

  if (afterItems.length > 0) {
    replacementBlocks.push(rebuildListBlock(context.list, afterItems));
  }

  const nextState = helpers.replaceRootRange(
    state,
    context.rootIndex,
    1,
    replacementBlocks,
    helpers.focusRootPrimaryRegion(context.rootIndex + (beforeItems.length > 0 ? 1 : 0)),
  );

  return {
    state: nextState,
  };
}

function liftEmptyNestedListItemOperation(
  state: EditorState,
  context: ListItemContext,
  helpers: ListHelpers,
) {
  if (
    !context.parentItem ||
    context.parentItemIndex === null ||
    !context.parentItemChildIndices ||
    !context.parentList ||
    !context.parentListChildIndices
  ) {
    return null;
  }

  const remainingNestedChildren = context.list.children.filter((_, index) => index !== context.itemIndex);
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
  const liftedChecked =
    typeof context.parentItem.checked === "boolean" ? false : context.parentItem.checked;
  const insertedItem = createInsertedListItem(
    "",
    liftedChecked,
    context.parentItem.spread,
  );
  const nextParentChildren = [
    ...context.parentList.children.slice(0, context.parentItemIndex),
    updatedParentItem,
    insertedItem,
    ...context.parentList.children.slice(context.parentItemIndex + 1),
  ];
  const nextParentList = rebuildListBlock(context.parentList, nextParentChildren);
  const nextState = helpers.applyBlockReplacement(
    state,
    context.parentList.id,
    nextParentList,
    helpers.focusDescendantPrimaryRegion(context.rootIndex, [
      ...context.parentListChildIndices,
      context.parentItemIndex + 1,
      0,
    ]),
  );

  return createInsertedListItemResult(
    nextState,
    insertedItem,
    context.rootIndex,
    [...context.parentListChildIndices, context.parentItemIndex + 1],
  );
}

export function handleListStructuralBackspaceOperation(state: EditorState, helpers: ListHelpers) {
  const context = helpers.extractListContext(state);

  if (!context) {
    return null;
  }

  if (typeof context.item.checked === "boolean") {
    const updatedItem = createListItemBlock({
      checked: null,
      children: context.item.children,
      spread: context.item.spread,
    });
    const nextChildren = context.list.children.map((child, index) =>
      index === context.itemIndex ? updatedItem : child,
    );
    const nextList = rebuildListBlock(context.list, nextChildren);

    return helpers.applyBlockReplacement(state, context.list.id, nextList);
  }

  if (context.itemIndex > 0) {
    const previousItem = context.list.children[context.itemIndex - 1];

    if (!previousItem) {
      return null;
    }

    if (context.item.plainText.length === 0) {
      const nextChildren = context.list.children.filter((_, index) => index !== context.itemIndex);
      const nextList = rebuildListBlock(context.list, nextChildren);
      const nextState = helpers.applyBlockReplacement(state, context.list.id, nextList);

      return nextState
        ? helpers.focusBlockContainerEnd(nextState, helpers.resolvePrimaryTextBlockId(previousItem))
        : null;
    }

    const mergedPrevious = helpers.replaceListItemLeadingParagraphText(
      previousItem,
      `${previousItem.plainText}${context.item.plainText}`,
    );

    if (!mergedPrevious) {
      return null;
    }

    const nextChildren = context.list.children.flatMap((child, index) => {
      if (index === context.itemIndex - 1) {
        return [mergedPrevious];
      }

      if (index === context.itemIndex) {
        return [];
      }

      return [child];
    });
    const nextList = rebuildListBlock(context.list, nextChildren);
    const nextState = helpers.applyBlockReplacement(state, context.list.id, nextList);

    return nextState
      ? helpers.focusBlockContainerEnd(nextState, helpers.resolvePrimaryTextBlockId(mergedPrevious))
      : null;
  }

  const paragraph = createParagraphTextBlock({
    text: context.item.plainText,
  });

  return helpers.replaceRootRange(
    state,
    context.rootIndex,
    1,
    [paragraph],
    helpers.focusRootPrimaryRegion(context.rootIndex),
  );
}

export function indentListItemOperation(state: EditorState, helpers: ListHelpers) {
  const context = helpers.extractListContext(state);

  if (!context || context.itemIndex === 0) {
    return null;
  }

  const previousItem = context.list.children[context.itemIndex - 1];

  if (!previousItem) {
    return null;
  }

  const nextPreviousItem = appendNestedListItem(previousItem, context.item, context);
  const nextChildren = context.list.children.flatMap((child, index) => {
    if (index === context.itemIndex - 1) {
      return [nextPreviousItem.item];
    }

    if (index === context.itemIndex) {
      return [];
    }

    return [child];
  });
  const nextList = rebuildListBlock(context.list, nextChildren);
  return helpers.applyBlockReplacement(
    state,
    context.list.id,
    nextList,
    helpers.focusDescendantPrimaryRegion(context.rootIndex, nextPreviousItem.regionChildIndices),
  );
}

export function dedentListItemOperation(state: EditorState, helpers: ListHelpers) {
  const context = helpers.extractListContext(state);

  if (
    !context ||
    !context.parentItem ||
    context.parentItemIndex === null ||
    !context.parentItemChildIndices ||
    !context.parentList ||
    !context.parentListChildIndices
  ) {
    return null;
  }

  const remainingNestedChildren = context.list.children.filter((_, index) => index !== context.itemIndex);
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
  const nextParentChildren = [
    ...context.parentList.children.slice(0, context.parentItemIndex),
    updatedParentItem,
    context.item,
    ...context.parentList.children.slice(context.parentItemIndex + 1),
  ];
  const nextParentList = rebuildListBlock(context.parentList, nextParentChildren);
  return helpers.applyBlockReplacement(
    state,
    context.parentList.id,
    nextParentList,
    helpers.focusDescendantPrimaryRegion(context.rootIndex, [
      ...context.parentListChildIndices,
      context.parentItemIndex + 1,
      0,
    ]),
  );
}

export function moveListItemUpOperation(state: EditorState, helpers: ListHelpers) {
  return moveListItemOperation(state, helpers, -1);
}

export function moveListItemDownOperation(state: EditorState, helpers: ListHelpers) {
  return moveListItemOperation(state, helpers, 1);
}

function moveListItemOperation(
  state: EditorState,
  helpers: ListHelpers,
  direction: -1 | 1,
) {
  const context = helpers.extractListContext(state);

  if (!context) {
    return null;
  }

  const targetIndex = context.itemIndex + direction;

  if (targetIndex < 0 || targetIndex >= context.list.children.length) {
    return null;
  }

  const nextChildren = [...context.list.children];
  const [item] = nextChildren.splice(context.itemIndex, 1);

  if (!item) {
    return null;
  }

  nextChildren.splice(targetIndex, 0, item);

  const nextList = rebuildListBlock(context.list, nextChildren);
  return helpers.applyBlockReplacement(
    state,
    context.list.id,
    nextList,
    helpers.focusDescendantPrimaryRegion(context.rootIndex, [
      ...context.listChildIndices,
      targetIndex,
      0,
    ]),
  );
}

function createInsertedListItem(
  text: string,
  checked: boolean | null,
  spread: boolean,
): ListItemBlock {
  return createListItemBlock({
    checked,
    children: [
      createParagraphTextBlock({
        text,
      }),
    ],
    spread,
  });
}

function createInsertedListItemResult(
  state: EditorState | null,
  item: ListItemBlock,
  rootIndex: number,
  childIndices: number[],
): ListOperationResult | null {
  return state
    ? {
        insertedListItemPath:
          typeof item.checked === "boolean"
            ? undefined
            : resolveListItemPath(rootIndex, childIndices),
        state,
      }
    : null;
}

function resolveListItemPath(rootIndex: number, childIndices: number[]) {
  return childIndices.reduce(
    (path, childIndex) => `${path}.children.${childIndex}`,
    `root.${rootIndex}`,
  );
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

    const nextNestedChildren = [...existingNestedList.children, item];
    const nextNestedList = rebuildListBlock(existingNestedList, nextNestedChildren);
    const nextChildren = previousItem.children.map((child, index) =>
      index === existingNestedListIndex ? nextNestedList : child,
    );

    return {
      item: rebuildListItemBlock(previousItem, nextChildren),
      regionChildIndices: [
        ...context.listChildIndices,
        context.itemIndex - 1,
        existingNestedListIndex,
        existingNestedList.children.length,
        0,
      ],
    };
  }

  const nestedList = createListBlock({
    children: [item],
    ordered: context.list.ordered,
    spread: context.list.spread,
    start: context.list.start,
  });
  const nextChildren = [...previousItem.children, nestedList];

  return {
    item: rebuildListItemBlock(previousItem, nextChildren),
    regionChildIndices: [
      ...context.listChildIndices,
      context.itemIndex - 1,
      previousItem.children.length,
      0,
      0,
    ],
  };
}
