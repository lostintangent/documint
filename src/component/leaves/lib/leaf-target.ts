import type { EditorHoverTarget } from "@/editor";
import type { CommentState } from "@/editor/comments";

export type ContextualLeaf =
  | {
      kind: "comment";
      left: number;
      link: {
        title: string | null;
        url: string;
      } | null;
      thread: CommentState["threads"][number];
      threadIndex: number;
      top: number;
    }
  | {
      endOffset: number;
      kind: "link";
      left: number;
      regionId: string;
      startOffset: number;
      title: string | null;
      top: number;
      url: string;
    };

export function resolveContextualLeaf(
  target: EditorHoverTarget | null,
  threads: CommentState["threads"],
): ContextualLeaf | null {
  if (!target || target.kind === "task-toggle") {
    return null;
  }

  if (target.commentThreadIndex !== null) {
    const thread = threads[target.commentThreadIndex] ?? null;

    if (!thread) {
      return null;
    }

    return {
      kind: "comment",
      left: target.anchorLeft,
      link:
        target.kind === "link"
          ? {
              title: target.title,
              url: target.url,
            }
          : null,
      thread,
      threadIndex: target.commentThreadIndex,
      top: target.anchorBottom,
    };
  }

  if (target.kind !== "link") {
    return null;
  }

  return {
    endOffset: target.endOffset,
    kind: "link",
    left: target.anchorLeft,
    regionId: target.regionId,
    startOffset: target.startOffset,
    title: target.title,
    top: target.anchorBottom,
    url: target.url,
  };
}
