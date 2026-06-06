import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createCommentThread,
  markCommentThreadAsResolved,
  type CommentThread,
} from "@/document";
import type { EditorPresence } from "@/editor";
import { AnnotationLeaf } from "@/component/overlays/leaves/AnnotationLeaf";
import { createStore, DocumintStoreProvider } from "@/component/store";
import { parseDocument } from "@/markdown";

const noop = () => {};

describe("AnnotationLeaf", () => {
  test("pulses comment presence for unresolved threads", () => {
    const html = renderCommentPresence(false);

    expect(html).toContain('class="comment-presence-dot is-pulsing"');
    expect(html).toContain("User is working on this");
  });

  test("keeps resolved thread presence visible without pulsing", () => {
    const html = renderCommentPresence(true);

    expect(html).toContain('class="comment-presence-dot"');
    expect(html).not.toContain("comment-presence-dot is-pulsing");
    expect(html).toContain("User is working on this");
  });
});

function renderCommentPresence(resolved: boolean) {
  const thread = createThread(resolved);
  const store = createStore(parseDocument("alpha\n"));

  return renderToStaticMarkup(
    <DocumintStoreProvider store={store}>
      <AnnotationLeaf
        canEdit={false}
        link={null}
        mode="thread"
        onDeleteComment={noop}
        onDeleteThread={noop}
        onEditComment={noop}
        onReply={noop}
        onToggleResolved={noop}
        presence={createPresence(thread)}
        thread={thread}
      />
    </DocumintStoreProvider>,
  );
}

function createThread(resolved: boolean): CommentThread {
  const thread = createCommentThread({
    anchor: { prefix: "alpha" },
    body: "Review this",
    createdAt: "2026-01-01T00:00:00.000Z",
    quote: "alpha",
  });

  return resolved
    ? markCommentThreadAsResolved(thread, true, "2026-01-01T00:01:00.000Z")
    : thread;
}

function createPresence(thread: CommentThread): EditorPresence {
  return {
    color: "#f97316",
    commentThreadIndex: 0,
    cursor: { threadId: thread.id },
    cursorPoint: null,
    id: "user",
    isOnUnresolvedCommentThread: true,
    username: "User",
    viewport: null,
  };
}
