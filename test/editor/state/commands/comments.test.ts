import { describe, expect, test } from "bun:test";
import { getCommentThreadUpdatedAt, isResolvedCommentThread } from "@/document";
import {
  deleteComment,
  deleteThread,
  editComment,
  replyToThread,
  resolveThread,
  type EditorState,
} from "@/editor/state";
import { setup } from "../../helpers";

const saved = "2026-04-05T12:00:00.000Z";
const markdown = `Hello world

:::documint-comments
[
  {
    "quote": "Hello",
    "anchor": { "suffix": " world" },
    "comments": [
      { "body": "one", "updatedAt": "${saved}" },
      { "body": "two", "updatedAt": "${saved}" },
      { "body": "three", "updatedAt": "${saved}" }
    ]
  },
  {
    "quote": "world",
    "anchor": { "prefix": "Hello " },
    "comments": [{ "body": "solo", "updatedAt": "${saved}" }],
    "resolvedAt": "${saved}"
  }
]
:::
`;

describe("Comment thread commands", () => {
  // Each thread reads as its comment bodies, marked "(updated)" when its
  // latest time moved past the saved one. Null means the command refused.
  test.each<[string, (state: EditorState) => EditorState | null, string[] | null]>([
    [
      "replying with padding",
      (state) => replyToThread(state, 0, "  four  "),
      ["one | two | three | four (updated)", "solo (resolved)"],
    ],
    [
      "editing a reply",
      (state) => editComment(state, 0, 1, "TWO"),
      ["one | TWO | three (updated)", "solo (resolved)"],
    ],
    ["deleting a reply", (state) => deleteComment(state, 0, 1), ["one | three", "solo (resolved)"]],
    [
      "deleting a thread's only comment",
      (state) => deleteComment(state, 1, 0),
      ["one | two | three"],
    ],
    ["deleting a thread", (state) => deleteThread(state, 0), ["solo (resolved)"]],
    [
      "resolving a thread",
      (state) => resolveThread(state, 0, true),
      ["one | two | three (resolved)", "solo (resolved)"],
    ],
    [
      "reopening a resolved thread",
      (state) => resolveThread(state, 1, false),
      ["one | two | three", "solo"],
    ],
    ["replying to a missing thread", (state) => replyToThread(state, 9, "four"), null],
    ["editing a comment to blank", (state) => editComment(state, 0, 0, "  "), null],
    ["editing a comment to the same text", (state) => editComment(state, 0, 0, "one"), null],
    ["resolving a resolved thread", (state) => resolveThread(state, 1, true), null],
  ])("saves the threads after %s", (_, command, threads) => {
    const state = setup(markdown);
    const next = command(state);

    expect(
      next?.documentIndex.document.comments.map(
        (thread) =>
          `${thread.comments.map(({ body }) => body).join(" | ")}${
            getCommentThreadUpdatedAt(thread) > saved ? " (updated)" : ""
          }${isResolvedCommentThread(thread) ? " (resolved)" : ""}`,
      ) ?? null,
    ).toEqual(threads);
    expect(next?.selection ?? state.selection).toBe(state.selection);
  });
});
