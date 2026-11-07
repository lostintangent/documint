import type { AnchorMatch, TextAnchor, TextAnchorCapture } from "../query/anchors/text";

export type CommentThread = {
  id: string;
  quote: string;
  comments: Comment[];
  anchor: CommentAnchor;
  resolvedAt?: string;
};

// A thread's saved anchor. `occurrence` tells identical copies apart on a cold
// read: it's the 1-based position of the thread's match among the copies its
// prefix, quote, and suffix all match, in document order, and it's only saved
// while there are two or more.
export type CommentAnchor = TextAnchor & {
  occurrence?: number;
};

export type Comment = {
  body: string;
  updatedAt: string;
};

// --- Anchor union ---
//
// `CommentThreadAnchor` is a comments-domain reference (a thread id) used by
// presence to attach a remote cursor to a comment thread instead of a text
// position. The `Anchor` union assembles it with the substrate's `TextAnchor`
// at the comments layer so the anchor algebra in `query/anchors/text.ts` can stay
// free of comments-domain identifiers — `TextAnchor` is content-addressable;
// `CommentThreadAnchor` is identity-addressable, and only consumers that know
// about threads should see the latter shape.

type CommentThreadAnchor = {
  threadId: string;
};

export type Anchor = TextAnchor | CommentThreadAnchor;

export function isCommentThreadAnchor(anchor: Anchor): anchor is CommentThreadAnchor {
  return "threadId" in anchor;
}

// --- Anchor resolution types ---

// Where a thread resolved in the current snapshot, plus the anchor and quote
// captured there. `repairCommentThread` writes the capture back to the thread.
// `occurrence` is set when the match won a tie among full-context copies.
export type CommentResolution = TextAnchorCapture & {
  match: AnchorMatch;
  occurrence?: number;
};
