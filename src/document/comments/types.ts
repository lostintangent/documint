import type { AnchorMatch, TextAnchor } from "../query/anchors/text";

export type CommentThread = {
  id: string;
  quote: string;
  comments: Comment[];
  anchor: TextAnchor;
  resolvedAt?: string;
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

// What needs to be refreshed on a `CommentThread` when its anchor drifts and
// has been re-located. Callers writing this back into a thread keep its
// quote/anchor representation in sync with the snapshot.
type CommentRepair = {
  anchor: TextAnchor;
  quote: string;
};

// Lifecycle of a thread reattachment attempt.
//   matched   - The anchor's exact context still appears in the snapshot.
//   repaired  - The anchor drifted; resolution recovered a best-fit location.
//   ambiguous - Multiple equally-strong locations exist; no safe pick.
//   stale     - The anchor can no longer be located.
// `repair` is non-null whenever `match` is non-null; together they describe
// where the thread lives now and how its persisted anchor and quote should be
// refreshed.
export type CommentResolution = {
  match: AnchorMatch | null;
  repair: CommentRepair | null;
  status: "ambiguous" | "matched" | "repaired" | "stale";
};
