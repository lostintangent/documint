import { gfmTaskListItemToMarkdown } from "mdast-util-gfm-task-list-item";
import type { Info, State } from "mdast-util-to-markdown";
import type { ListItem, Parents } from "mdast";

const gfmTaskListMarkdown = gfmTaskListItemToMarkdown();
const gfmTaskListItemHandler = getGfmTaskListItemHandler();
const defaultListBullet = "-";

export function serializeTaskListItem(
  node: ListItem,
  parent: Parents | undefined,
  state: State,
  info: Info,
) {
  const value = gfmTaskListItemHandler(node, parent, state, info);

  if (typeof node.checked !== "boolean" || !/^([*+-]|\d+\.)\n?$/.test(value)) {
    return value;
  }

  const bullet = getListMarker(parent, state);
  const checkbox = `[${node.checked ? "x" : " "}] `;

  return `${bullet} ${checkbox}`;
}

function getListMarker(parent: Parents | undefined, state: State) {
  if (parent?.type === "list" && parent.ordered) {
    return `${parent.start ?? 1}.`;
  }

  return state.bulletCurrent || state.options.bullet || defaultListBullet;
}

function getGfmTaskListItemHandler() {
  const handler = gfmTaskListMarkdown.handlers?.listItem;

  if (!handler) {
    throw new Error("Expected GFM task-list markdown handler");
  }

  return handler;
}
