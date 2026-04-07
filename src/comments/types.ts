export type Comment = {
  body: string;
  updatedAt: string;
};

export type CommentAnchor = {
  kind?: "code" | "tableCell";
  prefix?: string;
  suffix?: string;
};

export type CommentThread = {
  anchor: CommentAnchor;
  comments: Comment[];
  quote: string;
  resolvedAt?: string;
};

export type CommentAnchorMatch = {
  containerId: string;
  containerKind: string;
  containerOrdinal: number;
  endOffset: number;
  startOffset: number;
};

export type CommentRepairMatchStrategy = "quote-selector" | "text-offset";

export type CommentRepairResult = {
  diagnostics: string[];
  match: CommentAnchorMatch | null;
  repairedThread: CommentThread | null;
  status: "ambiguous" | "repaired" | "stale" | "unchanged";
  strategy: CommentRepairMatchStrategy | null;
};

export type CommentAppendixPayload = {
  threads: CommentThread[];
};

export type CommentTargetContainer = {
  containerKind: string;
  containerOrdinal: number;
  id: string;
  text: string;
};

export type CommentThreadList = CommentThread[];
