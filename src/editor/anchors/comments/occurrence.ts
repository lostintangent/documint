/**
 * Occurrence hints: which identical copy of its text a comment sits on, saved
 * so a reload lands on the same copy.
 *
 * Carry tells copies apart by proving where each thread matched last time,
 * but a cold read (parsed markdown) has no last time. So every carry keeps
 * each thread's saved `anchor.occurrence` in step with its record: the match's
 * 1-based position among its copies, which are the places where the quote
 * appears with its whole saved prefix and suffix. The hint is only saved while
 * there are two or more copies, so unique comments save unchanged.
 *
 * Counting copies walks the document, so a carried match keeps its hint unless
 * copies could have moved around it: the thread's anchor isn't the one the
 * previous Document saved, or a container the commit changed holds a copy
 * other than the match itself.
 */

import {
  resolveCommentThread,
  type AnchorContainer,
  type AnchorMatch,
  type CommentAnchor,
  type CommentThread,
  type Document,
} from "@/document";
import type { DocumentIndex } from "../../state";
import { anchorContainerForText } from "../text";
import type { ChangedRoots } from "./carry";

type ChangedContainers = {
  next: AnchorContainer[];
  previous: AnchorContainer[];
  // Every changed container's text, so threads whose quote isn't in it skip
  // the copy search.
  text: string;
};

// --- Public API ---

// Returns the occurrence a carried thread saves in `next`, given where it
// matches there and its prior: the anchor the previous Document saved for it
// (`null` for a new thread) and where it matched in `previous`.
export function createOccurrenceTracker(
  previous: DocumentIndex,
  next: DocumentIndex,
  findChangedRoots: () => ChangedRoots,
  listContainers: () => AnchorContainer[],
) {
  let changed: ChangedContainers | null = null;

  return (
    thread: CommentThread,
    match: AnchorMatch,
    prior: { anchor: CommentAnchor | null; match: AnchorMatch },
  ): number | undefined => {
    if (thread.anchor === prior.anchor) {
      changed ??= listChangedContainers(previous, next, findChangedRoots());

      const hasCopyAround =
        changed.text.includes(thread.quote) &&
        (changed.previous.some((container) =>
          holdsCopy(container, thread, match.containerKind, prior.match),
        ) ||
          changed.next.some((container) =>
            holdsCopy(container, thread, match.containerKind, match),
          ));

      if (!hasCopyAround) {
        return thread.anchor.occurrence;
      }
    }

    return hasUniqueFingerprint(next.document, thread)
      ? undefined
      : resolveCommentThread(thread, listContainers(), match)?.occurrence;
  };
}

// Returns `thread` with `occurrence` saved on its anchor, or `thread` itself
// when the hint doesn't change.
export function withOccurrence(
  thread: CommentThread,
  occurrence: number | undefined,
): CommentThread {
  if (thread.anchor.occurrence === occurrence) {
    return thread;
  }

  const { occurrence: _, ...anchor } = thread.anchor;

  return {
    ...thread,
    anchor: occurrence === undefined ? anchor : { ...anchor, occurrence },
  };
}

// --- Copies ---

// Whether `container` holds a copy of the thread's anchor, other than `own`.
// Copies can overlap, so the search steps one character at a time.
function holdsCopy(
  { containerKind, path, text }: AnchorContainer,
  { anchor: { prefix, suffix }, quote }: CommentThread,
  kind: AnchorContainer["containerKind"],
  own: AnchorMatch,
) {
  if (containerKind !== kind || !quote) {
    return false;
  }

  const ownStart = own.containerPath === path ? own.startOffset : -1;

  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    if (
      at !== ownStart &&
      (!prefix || text.endsWith(prefix, at)) &&
      (!suffix || text.startsWith(suffix, at + quote.length))
    ) {
      return true;
    }
  }

  return false;
}

// Whether the thread's prefix, quote, and suffix appear at most once across
// the document's root text, which skips a full resolve in the common case.
// Nested blocks trim their joined text, so this searches the trimmed
// fingerprint, which finds every copy and can only over-count.
function hasUniqueFingerprint(document: Document, { anchor, quote }: CommentThread) {
  const fingerprint = `${anchor.prefix ?? ""}${quote}${anchor.suffix ?? ""}`.trim();

  if (!fingerprint) {
    return false;
  }

  let count = 0;

  for (const { plainText } of document.blocks) {
    for (
      let at = plainText.indexOf(fingerprint);
      at !== -1;
      at = plainText.indexOf(fingerprint, at + 1)
    ) {
      if (++count > 1) {
        return false;
      }
    }
  }

  return true;
}

// --- Changed containers ---

// The anchor containers a commit changed on each side: those under the changed
// roots, minus any whose node is the same object at the same path on the other
// side, so a one-cell edit changes one cell rather than the whole table.
// Everything skipped keeps its text and its order relative to other skipped
// copies. It also keeps its order relative to a moved match, because commands
// that move content shift everything they move it past.
function listChangedContainers(
  previous: DocumentIndex,
  next: DocumentIndex,
  { nextEnd, previousEnd, start }: ChangedRoots,
): ChangedContainers {
  const changedNext = listContainersMissingFrom(next, previous, start, nextEnd);
  const changedPrevious = listContainersMissingFrom(previous, next, start, previousEnd);

  return {
    next: changedNext,
    previous: changedPrevious,
    text: [...changedPrevious, ...changedNext].map(({ text }) => text).join("\n"),
  };
}

// Containers under `documentIndex`'s roots in `[start, end)` whose node isn't
// at the same path in `other`.
function listContainersMissingFrom(
  documentIndex: DocumentIndex,
  other: DocumentIndex,
  start: number,
  end: number,
) {
  const containers: AnchorContainer[] = [];
  const add = (container: AnchorContainer | null) => {
    if (container) {
      containers.push(container);
    }
  };

  for (let rootIndex = start; rootIndex < end; rootIndex += 1) {
    for (const entry of documentIndex.roots[rootIndex]!.blocks) {
      if (entry.kind === "cells") {
        for (const row of entry.tableCellRows) {
          for (const cell of row) {
            if (other.tableCellIndex.get(cell.path)?.cell !== cell.cell) {
              add(anchorContainerForText(cell));
            }
          }
        }
      } else if (
        (entry.kind === "inlines" || entry.kind === "source") &&
        other.blockIndex.get(entry.path)?.block !== entry.block
      ) {
        add(anchorContainerForText(entry));
      }
    }
  }

  return containers;
}
