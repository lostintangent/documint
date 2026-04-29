import { expect, test } from "bun:test";
import {
  addComment,
  deleteComment,
  deleteThread,
  editComment,
  replyToThread,
  resolveThread,
} from "@/editor/state";
import { setup, getRegion } from "../helpers";

function stateWithThread() {
  const state = setup("Hello world\n");
  const region = getRegion(state, "Hello world");
  return addComment(state, { regionId: region.id, startOffset: 0, endOffset: 5 }, "First comment")!;
}

test("adds a reply to an existing comment thread", () => {
  const state = stateWithThread();
  const next = replyToThread(state, 0, "My reply");

  expect(next).not.toBeNull();
  const thread = next!.documentIndex.document.comments[0];
  expect(thread?.comments).toHaveLength(2);
  expect(thread?.comments[1]?.body).toBe("My reply");
});

test("edits an existing comment in a thread", () => {
  const state = stateWithThread();
  const next = editComment(state, 0, 0, "Edited body");

  expect(next).not.toBeNull();
  const thread = next!.documentIndex.document.comments[0];
  expect(thread?.comments[0]?.body).toBe("Edited body");
});

test("deletes a reply from a thread without removing the thread", () => {
  const withReply = replyToThread(stateWithThread(), 0, "Reply to delete")!;
  const next = deleteComment(withReply, 0, 1);

  expect(next).not.toBeNull();
  const thread = next!.documentIndex.document.comments[0];
  expect(thread?.comments).toHaveLength(1);
});

test("deletes a thread entirely when only comment is removed", () => {
  const state = stateWithThread();
  const next = deleteThread(state, 0);

  expect(next).not.toBeNull();
  expect(next!.documentIndex.document.comments).toHaveLength(0);
});

test("resolves a comment thread", () => {
  const state = stateWithThread();
  const resolved = resolveThread(state, 0, true);

  expect(resolved).not.toBeNull();
  expect(resolved!.documentIndex.document.comments[0]?.resolvedAt).toBeTruthy();
});

test("unresolves a previously resolved thread", () => {
  const resolved = resolveThread(stateWithThread(), 0, true)!;
  const unresolved = resolveThread(resolved, 0, false);

  expect(unresolved).not.toBeNull();
  expect(unresolved!.documentIndex.document.comments[0]?.resolvedAt).toBeUndefined();
});

test("returns null when targeting a thread index that does not exist", () => {
  const state = stateWithThread();
  expect(replyToThread(state, 99, "ghost reply")).toBeNull();
  expect(deleteThread(state, 99)).toBeNull();
  expect(resolveThread(state, 99, true)).toBeNull();
});
