import { useMemo } from "react";
import { compareDocuments, type Document, type DocumentChange } from "@/document";
import { parseDocument, type MarkdownOptions } from "@/markdown";

const emptyDocumentChanges: readonly DocumentChange[] = [];

export type DocumentView = {
  readonly canMutateComments: boolean;
  readonly document: Document;
  readonly readOnly: boolean;
  readonly showActiveBlockHighlight: boolean;
  readonly showDiffs: boolean;
  readonly showReviewChrome: boolean;
} & (
  | { readonly kind: "live" }
  | {
      readonly changes: readonly DocumentChange[];
      readonly kind: "snapshot";
    }
);

export function useDocumentView({
  canChangeContent,
  content,
  markdownOptions,
  previousContent,
  readOnly: readOnlyProp,
  showDiffs,
}: {
  canChangeContent: boolean;
  content: string;
  markdownOptions: MarkdownOptions;
  previousContent?: string;
  readOnly: boolean;
  showDiffs: boolean;
}): DocumentView {
  const currentDocument = useMemo(
    () => parseDocument(content, markdownOptions),
    [content, markdownOptions],
  );
  const snapshotComparison = useMemo(() => {
    if (previousContent === undefined || !showDiffs) {
      return null;
    }

    return compareDocuments(parseDocument(previousContent, markdownOptions), currentDocument);
  }, [currentDocument, markdownOptions, previousContent, showDiffs]);
  const isSnapshot = previousContent !== undefined;
  const view = {
    canMutateComments: canChangeContent && !isSnapshot,
    document: snapshotComparison?.document ?? currentDocument,
    readOnly: isSnapshot || readOnlyProp || !canChangeContent,
    showActiveBlockHighlight: !isSnapshot,
    showDiffs,
    showReviewChrome: isSnapshot || canChangeContent || readOnlyProp,
  };

  return isSnapshot
    ? {
        ...view,
        changes: snapshotComparison?.changes ?? emptyDocumentChanges,
        kind: "snapshot",
      }
    : { ...view, kind: "live" };
}
