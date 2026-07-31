import type { CommentChange, UserMentionEvent } from "@lostintangent/documint";

export type PlaygroundHostEvent = {
  detail: string;
  fields: Array<[string, string | number]>;
  title: string;
};

const commentEventTitleByKind: Record<CommentChange["kind"], string> = {
  added: "Comment added",
  deleted: "Comment deleted",
  edited: "Comment edited",
};

export function createUserMentionHostEvent(event: UserMentionEvent): PlaygroundHostEvent {
  return {
    detail: event.lineMarkdown || "(empty)",
    fields: [
      ["userId", event.userId],
      ["line", event.lineNumber],
    ],
    title: "User mentioned",
  };
}

export function createCommentHostEvent(change: CommentChange): PlaygroundHostEvent {
  const fields: PlaygroundHostEvent["fields"] = [["thread", change.threadId]];
  if (change.kind !== "deleted") {
    fields.push(["mentions", change.mentionedUserIds.length]);
  }

  return {
    detail: change.comment.body || "(empty)",
    fields,
    title: commentEventTitleByKind[change.kind],
  };
}
