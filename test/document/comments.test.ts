import { describe, expect, test } from "bun:test";
import {
  createAnchorFromContainer,
  createCommentThread,
  deleteCommentFromThread,
  editCommentInThread,
  extractQuoteFromContainer,
  getCommentThreadUpdatedAt,
  isResolvedCommentThread,
  listAnchorContainers,
  markCommentThreadAsResolved,
  resolveCommentThread,
} from "@/document";
import { parseDocument } from "@/markdown";

describe("Comment anchors", () => {
  test("creates durable anchors from semantic text containers", () => {
    const snapshot = parseDocument("# Title\n\nReview surface anchors survive.\n");
    const container = listAnchorContainers(snapshot)[1];

    if (!container) {
      throw new Error("Expected review paragraph container");
    }

    const anchor = createAnchorFromContainer(container, 0, 14);

    expect(anchor.kind).toBeUndefined();
    expect(anchor.prefix).toBeUndefined();
    expect(extractQuoteFromContainer(container, 0, 14)).toBe("Review surface");
  });

  test("repairs anchors against changed semantic content", () => {
    const { thread } = createAnchoredThread(
      "Review surface anchors survive markdown reloads.\n",
      15,
      30,
      "Protect this anchored span.",
    );
    const edited = parseDocument(
      "Review surface editing keeps anchors survive markdown reloads.\n",
    );
    const resolution = resolveCommentThread(thread, edited);

    expect(resolution.status).toBe("repaired");
    expect(resolution.match?.startOffset).toBeGreaterThan(0);
    expect(resolution.repair?.quote).toBe("anchors survive");
  });

  test("repairs anchors when the quoted text is edited in place", () => {
    const { thread } = createAnchoredThread(
      "Typpoed person name appears here.\n",
      0,
      12,
      "Fix the typo, keep the comment.",
    );
    const edited = parseDocument("Typoed person name appears here.\n");
    const resolution = resolveCommentThread(thread, edited);

    expect(resolution.status).toBe("repaired");
    expect(resolution.repair?.quote).toBe("Typoed pers");
  });

  test("keeps comments sticky when the containing block moves in the document", () => {
    const { thread } = createAnchoredThread(
      "Alpha intro.\n\nUnique quoted phrase lives here.\n\nOmega tail.\n",
      0,
      20,
      "This should move with the paragraph.",
      { containerIndex: 1 },
    );
    const moved = parseDocument(
      "Omega tail.\n\nUnique quoted phrase lives here.\n\nAlpha intro.\n",
    );
    const resolution = resolveCommentThread(thread, moved);

    expect(resolution.status).toBe("matched");
    expect(resolution.match?.containerKind).toBe("text");
    expect(resolution.repair?.quote).toBe("Unique quoted phrase");
  });

  test("keeps comments sticky when a paragraph becomes a heading", () => {
    const { thread } = createAnchoredThread(
      "Promote this line.\n",
      0,
      12,
      "This should survive heading promotion.",
    );
    const promoted = parseDocument("# Promote this line.\n");
    const resolution = resolveCommentThread(thread, promoted);

    expect(resolution.status).toBe("matched");
    expect(resolution.match?.containerKind).toBe("text");
    expect(resolution.repair?.quote).toBe("Promote this");
  });

  test("lists nested anchor containers in visible order", () => {
    const snapshot = parseDocument(`# Title

> Quote body

:::callout{tone="info"}
Directive body
:::

- outer item
  - inner item

\`\`\`ts
console.log("hi");
\`\`\`

| A | B |
| - | - |
| one | two |
`);
    const containers = listAnchorContainers(snapshot);
    const outerListParagraph = containers[2];
    const innerListParagraph = containers[3];
    const codeContainer = containers[4];
    const firstTableCell = containers[5];

    expect(containers.map((container) => `${container.containerKind}:${container.text}`)).toEqual([
      "text:Title",
      "text:Quote body",
      "text:outer item",
      "text:inner item",
      'code:console.log("hi");',
      "tableCell:A",
      "tableCell:B",
      "tableCell:one",
      "tableCell:two",
    ]);
    expect(containers.map((container) => container.containerOrdinal)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(outerListParagraph?.containerKind).toBe("text");
    expect(innerListParagraph?.containerKind).toBe("text");
    expect(codeContainer?.containerKind).toBe("code");
    expect(firstTableCell?.containerKind).toBe("tableCell");
    expect(new Set(containers.slice(5).map((container) => container.id)).size).toBe(4);
  });
});

describe("Comment threads", () => {
  test("serializes thread payloads deterministically and tracks status transitions", () => {
    const { thread } = createAnchoredThread(
      "Review surface anchors survive.\n",
      0,
      6,
      "Initial note.",
    );
    const resolved = markCommentThreadAsResolved(thread, true, "2026-04-05T13:00:00.000Z");

    expect(JSON.stringify(resolved)).not.toContain('"status"');
    expect(resolved.resolvedAt).toBe("2026-04-05T13:00:00.000Z");
    expect(isResolvedCommentThread(resolved)).toBe(true);
  });

  test("edits and deletes thread comments without moving thread ownership into the UI", () => {
    const { thread } = createAnchoredThread(
      "Review surface anchors survive.\n",
      0,
      6,
      "Initial note.",
    );
    const replyThread = appendReply(thread);
    const editedThread = editCommentInThread(
      replyThread,
      1,
      "Edited follow-up note.",
      "2026-04-05T14:00:00.000Z",
    );
    const deletedReplyThread = deleteCommentFromThread(editedThread, 1);
    const deletedThread = deleteCommentFromThread(thread, 0);

    expect(editedThread.comments[1]?.body).toBe("Edited follow-up note.");
    expect(editedThread.comments[1]?.updatedAt).toBe("2026-04-05T14:00:00.000Z");
    expect(deletedReplyThread?.comments).toHaveLength(1);
    expect(getCommentThreadUpdatedAt(deletedReplyThread!)).toBe("2026-04-05T12:00:00.000Z");
    expect(deletedThread).toBeNull();
  });
});

function createAnchoredThread(
  source: string,
  startOffset: number,
  endOffset: number,
  body: string,
  options: { containerIndex?: number } = {},
) {
  const snapshot = parseDocument(source);
  const container = listAnchorContainers(snapshot)[options.containerIndex ?? 0];

  if (!container) {
    throw new Error("Expected anchor container");
  }

  return {
    container,
    snapshot,
    thread: createCommentThread({
      anchor: createAnchorFromContainer(container, startOffset, endOffset),
      body,
      createdAt: "2026-04-05T12:00:00.000Z",
      quote: extractQuoteFromContainer(container, startOffset, endOffset),
    }),
  };
}

function appendReply(thread: ReturnType<typeof createCommentThread>) {
  return {
    ...thread,
    comments: [
      ...thread.comments,
      {
        body: "Follow-up note.",
        updatedAt: "2026-04-05T13:00:00.000Z",
      },
    ],
  };
}
