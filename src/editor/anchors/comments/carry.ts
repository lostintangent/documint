/**
 * Comment records: where each thread matched in one document snapshot.
 *
 * Every snapshot gets one record per thread, holding the thread's semantic
 * match and the editor range it maps to, or `null` when it doesn't resolve.
 * `getCommentState` reads its runtime state from them. Records are keyed by
 * `Document`, so undo and redo, which restore Documents from history, restore
 * their records too, and selection moves keep them.
 *
 * Fresh documents (parsed markdown, host snapshots) resolve cold. Reducer
 * commits instead carry each thread's match forward from the previous
 * snapshot, because resolution alone can't tell identical quotes apart:
 *
 *   - Rule A: a match in the edited path is remapped through the edit's
 *     splice math, and the re-captured anchor is written into the document.
 *     A record whose last character the edit deleted keeps its end open, so
 *     text typed right there extends it until another commit closes it.
 *   - Rule B: a match whose location is proven (its node is the same object
 *     in both snapshots, wherever it moved, or a new thread was just captured
 *     there) is reused while the thread still anchors exactly there.
 *   - Rule C: anything else re-resolves, preferring a proven prior on ties.
 *
 * A prior only steers the next match when its location is proven, so carry
 * can hide a comment but never move it onto another copy of its text. Cold
 * reads have no prior, so ties fall back to each thread's saved occurrence,
 * which every carry keeps in step with its record (see `occurrence.ts`).
 */

import {
  captureTextAnchor,
  listAnchorContainers,
  pathWithRootIndex,
  repairCommentThread,
  resolveCommentThread,
  rootIndexForPath,
  type AnchorContainer,
  type AnchorMatch,
  type Block,
  type CommentAnchor,
  type CommentResolution,
  type CommentThread,
  type Document,
  type TableCell,
  type TextAnchorCapture,
} from "@/document";
import type { DocumentIndex } from "../../state";
import { replaceIndexedDocument } from "../../state/index/splice";
import type { EditorStateAction } from "../../state/types";
import { resolveDocumentRangeForPath, resolveEditorRangeForAnchorMatch } from "../text";
import { mapOffsetThroughTextEdit, type TextEdit, type TextRange } from "../../text/ranges";
import { createOccurrenceTracker, withOccurrence } from "./occurrence";

// --- Types ---

export type EditorCommentRange = {
  endOffset: number;
  path: string;
  resolved: boolean;
  startOffset: number;
  threadIndex: number;
};

export type EditorCommentState = {
  ranges: EditorCommentRange[];
  threads: CommentThread[];
};

// What a commit changed, when its caller knows.
export type CommentChange = {
  // A text edit inside one path, in editor offsets.
  edit?: { endOffset: number; insertedText: string; path: string; startOffset: number };
  splice?: Pick<
    Extract<EditorStateAction, { kind: "splice-comments" }>,
    "count" | "index" | "matches" | "threads"
  >;
};

type CommentRecord = {
  match: AnchorMatch;
  // Whether text inserted right at the match's end extends it.
  openEnd: boolean;
  range: EditorCommentRange;
};

type CommentRecords = {
  records: (CommentRecord | null)[];
  state: EditorCommentState;
};

type Carry = {
  change: CommentChange;
  previous: DocumentIndex;
  prior: CommentRecords;
};

// The roots a commit changed, as `[start, end)` root ranges in each Document.
// Roots before `start` and after each end are the same objects in the same
// order on both sides, so only the roots after the end shift index.
export type ChangedRoots = {
  nextEnd: number;
  previousEnd: number;
  start: number;
};

// Written once per Document, when a commit carries into it or on its first
// cold read, and never mutated afterwards.
const recordsByDocument = new WeakMap<Document, CommentRecords>();

// --- Public API ---

// Every thread resolved against the snapshot: runtime ranges for the threads
// that resolve, plus thread copies whose anchors were repaired in memory.
// Unresolved threads keep their persisted entry, ready to repair later.
export function getCommentState(documentIndex: DocumentIndex): EditorCommentState {
  return readRecords(documentIndex).state;
}

// Record `next`'s comments by carrying `previous`'s records through `change`.
// Returns `next`, or an index over a Document whose comments hold the edited
// path's repaired anchors. Safe to call at every commit: it does nothing when
// `next` has no comments or its Document already has records.
export function carryComments(
  previous: DocumentIndex,
  next: DocumentIndex,
  change: CommentChange = {},
): DocumentIndex {
  if (next.document.comments.length === 0 || recordsByDocument.has(next.document)) {
    return next;
  }

  return recordComments(next, { change, previous, prior: readRecords(previous) });
}

// --- Recording ---

function readRecords(documentIndex: DocumentIndex): CommentRecords {
  return (
    recordsByDocument.get(documentIndex.document) ??
    recordsByDocument.get(recordComments(documentIndex, null).document)!
  );
}

function recordComments(next: DocumentIndex, carry: Carry | null): DocumentIndex {
  const comments = next.document.comments;
  const records: (CommentRecord | null)[] = [];
  const ranges: EditorCommentRange[] = [];
  // Rule A repairs and occurrence hints go into the document. Rule C repairs
  // stay in state only.
  let documentThreads: CommentThread[] | null = null;
  let stateThreads: CommentThread[] | null = null;
  let hasStateOnlyRepair = false;
  let containers: AnchorContainer[] | null = null;
  const listContainers = () => (containers ??= listAnchorContainers(next.document));
  const edit = carry?.change.edit;
  const remap = edit ? createEditRemap(carry!.previous, next, edit) : null;
  const findPrior = carry ? createPriorFinder(carry) : null;
  let changedRoots: ChangedRoots | null = null;
  const findChangedRoots = () =>
    (changedRoots ??= compareRoots(carry!.previous.document, next.document));
  const proveMatch = carry ? createMatchProver(carry.previous, next, findChangedRoots) : null;
  const trackOccurrence = carry
    ? createOccurrenceTracker(carry.previous, next, findChangedRoots, listContainers)
    : null;

  for (const [threadIndex, thread] of comments.entries()) {
    const resolved = thread.resolvedAt != null;
    const prior = findPrior?.(threadIndex) ?? null;
    const remapped = prior?.record && remap ? remap(prior.record) : null;
    let record: CommentRecord | null = null;
    let resolution: CommentResolution | null = null;
    let documentThread = thread;

    if (remapped) {
      // Rule A.
      record = recordFor(next, remapped.match, threadIndex, resolved, remapped.openEnd);
      documentThread = repairCommentThread(thread, remapped.capture);
    } else {
      const match = prior?.record ? proveMatch!(prior.match) : (prior?.match ?? null);

      if (match && repairCommentThread(thread, prior!.capture) === thread) {
        // Rule B.
        record = prior!.record
          ? reuseRecord(prior!.record, match.containerPath, threadIndex, resolved)
          : recordFor(next, match, threadIndex, resolved);
      } else {
        // Rule C. Only cold reads break ties with the saved occurrence, since
        // a commit may have changed which copies exist.
        resolution = resolveCommentThread(
          thread,
          listContainers(),
          carry ? match : (thread.anchor.occurrence ?? null),
        );
        record = resolution && recordFor(next, resolution.match, threadIndex, resolved);
      }
    }

    // Rule C reports the occurrence it resolved, counted against the saved
    // anchor a reload would resolve, and rules A and B keep theirs in step.
    if (trackOccurrence) {
      documentThread = withOccurrence(
        documentThread,
        !record
          ? undefined
          : resolution
            ? resolution.occurrence
            : trackOccurrence(documentThread, record.match, prior!),
      );
    }

    const stateThread =
      record && resolution ? repairCommentThread(documentThread, resolution) : documentThread;

    records.push(record);

    if (record) {
      ranges.push(record.range);
    }

    if (documentThread !== thread) {
      (documentThreads ??= [...comments])[threadIndex] = documentThread;
    }

    if (stateThread !== thread) {
      (stateThreads ??= [...comments])[threadIndex] = stateThread;
    }

    hasStateOnlyRepair ||= stateThread !== documentThread;
  }

  const documentIndex = documentThreads
    ? replaceIndexedDocument(next, { ...next.document, comments: documentThreads })
    : next;

  recordsByDocument.set(documentIndex.document, {
    records,
    state: {
      ranges,
      threads: hasStateOnlyRepair ? stateThreads! : documentIndex.document.comments,
    },
  });

  return documentIndex;
}

function recordFor(
  documentIndex: DocumentIndex,
  match: AnchorMatch,
  threadIndex: number,
  resolved: boolean,
  openEnd = false,
): CommentRecord | null {
  const range = resolveEditorRangeForAnchorMatch(documentIndex, match);

  return range ? { match, openEnd, range: { ...range, resolved, threadIndex } } : null;
}

// Reuse a prior record without converting offsets again, rewriting only what
// moved: the path after a root move, the thread index, and the resolved flag.
// A reused record's end is closed, since the commit wasn't typing at it.
function reuseRecord(
  record: CommentRecord,
  path: string,
  threadIndex: number,
  resolved: boolean,
): CommentRecord {
  const { match, range } = record;

  if (
    !record.openEnd &&
    range.path === path &&
    range.threadIndex === threadIndex &&
    range.resolved === resolved
  ) {
    return record;
  }

  return {
    match: match.containerPath === path ? match : { ...match, containerPath: path },
    openEnd: false,
    range: { ...range, path, resolved, threadIndex },
  };
}

// --- Priors ---

type Prior = {
  // The anchor the previous Document saved for the thread, or null for a new
  // thread.
  anchor: CommentAnchor | null;
  // A thread captured exactly at `match`: the prior state's copy, or a new
  // thread itself.
  capture: TextAnchorCapture;
  match: AnchorMatch;
  // The record to reuse, or null for a new thread, whose match is proven
  // because it was just captured there.
  record: CommentRecord | null;
};

// Pairs each next thread with its prior by position. Only `splice-comments`
// reshapes the list: threads before it keep their index, threads after it
// shift, and a spliced-in thread either brings its own capture or continues
// the thread it replaced, as an in-place reply or resolve does.
function createPriorFinder({ change, previous, prior }: Carry) {
  const previousComments = previous.document.comments;
  const { splice } = change;

  return (threadIndex: number): Prior | null => {
    let priorIndex: number | null = threadIndex;

    if (splice && threadIndex >= splice.index + splice.threads.length) {
      priorIndex = threadIndex - splice.threads.length + splice.count;
    } else if (splice && threadIndex >= splice.index) {
      const slot = threadIndex - splice.index;
      const seed = splice.matches?.[slot];

      if (seed) {
        return { anchor: null, capture: splice.threads[slot]!, match: seed, record: null };
      }

      priorIndex = slot < splice.count ? threadIndex : null;
    }

    const record = priorIndex === null ? null : prior.records[priorIndex];

    return record
      ? {
          anchor: previousComments[priorIndex!]!.anchor,
          capture: prior.state.threads[priorIndex!]!,
          match: record.match,
          record,
        }
      : null;
  };
}

// --- Proof ---

// Returns a prior match's location in `next`, when proven. Node identity is
// proof, because editing never puts one node object in a Document twice: the
// node at the match's path is the same object in both snapshots, its root is
// one of the unchanged roots that shifted, or it moved intact within the roots
// the commit changed, as a cell does when a row is inserted above it. Only
// that last check walks nodes, once per commit and only through the changed
// roots.
function createMatchProver(
  previous: DocumentIndex,
  next: DocumentIndex,
  findChangedRoots: () => ChangedRoots,
) {
  let movedPaths: Map<Block | TableCell, string> | null = null;

  return (match: AnchorMatch): AnchorMatch | null => {
    const path = match.containerPath;
    const node = nodeAt(previous, path);

    if (!node || node === nodeAt(next, path)) {
      return node ? match : null;
    }

    const changed = findChangedRoots();
    const rootIndex = rootIndexForPath(path)!;
    const movedPath =
      rootIndex >= changed.previousEnd
        ? pathWithRootIndex(path, rootIndex - changed.previousEnd + changed.nextEnd)
        : (movedPaths ??= mapNodePaths(next, changed)).get(node);

    return movedPath ? { ...match, containerPath: movedPath } : null;
  };
}

function nodeAt(documentIndex: DocumentIndex, path: string) {
  return documentIndex.blockIndex.get(path)?.block ?? documentIndex.tableCellIndex.get(path)?.cell;
}

// Each block and table cell under `documentIndex`'s changed roots, mapped to
// its path.
function mapNodePaths({ roots }: DocumentIndex, { nextEnd, start }: ChangedRoots) {
  const paths = new Map<Block | TableCell, string>();

  for (let rootIndex = start; rootIndex < nextEnd; rootIndex += 1) {
    for (const entry of roots[rootIndex]!.blocks) {
      paths.set(entry.block, entry.path);

      if (entry.kind === "cells") {
        for (const row of entry.tableCellRows) {
          for (const { cell, path } of row) {
            paths.set(cell, path);
          }
        }
      }
    }
  }

  return paths;
}

function compareRoots(previous: Document, next: Document): ChangedRoots {
  const before = previous.blocks;
  const after = next.blocks;
  const limit = Math.min(before.length, after.length);
  let start = 0;
  let end = 0;

  while (start < limit && before[start] === after[start]) {
    start += 1;
  }

  while (end < limit - start && before[before.length - 1 - end] === after[after.length - 1 - end]) {
    end += 1;
  }

  return { nextEnd: after.length - end, previousEnd: before.length - end, start };
}

// --- Edit remap ---

// Translates records in the edited container through the edit's splice math,
// in semantic container offsets, and returns null for records elsewhere. Null
// itself when the edited path has no anchorable text on either side of the
// edit. A known edit needs no fingerprint search, which keeps typing cheap and
// avoids drift when the edit lands inside an anchor's prefix or suffix.
function createEditRemap(
  previous: DocumentIndex,
  next: DocumentIndex,
  edit: NonNullable<CommentChange["edit"]>,
) {
  const editRange = resolveDocumentRangeForPath(previous, edit.path, edit);
  const container = resolveDocumentRangeForPath(next, edit.path, {
    endOffset: 0,
    startOffset: 0,
  })?.anchorContainer;

  if (!editRange || !container) {
    return null;
  }

  const textEdit: TextEdit = {
    endOffset: editRange.endOffset,
    insertedLength: edit.insertedText.length,
    startOffset: editRange.startOffset,
  };

  return ({ match, openEnd }: CommentRecord) => {
    if (match.containerPath !== editRange.anchorContainer.path) {
      return null;
    }

    const remapped = remapCommentRange(match, textEdit, openEnd);

    return {
      capture: captureTextAnchor(container, remapped.start, remapped.end),
      match: {
        containerKind: container.containerKind,
        containerPath: container.path,
        endOffset: remapped.end,
        startOffset: remapped.start,
      },
      openEnd: remapped.openEnd,
    };
  };
}

// Comments absorb text an edit replaces inside them, while text inserted at
// either edge stays outside, and a collapsed range at an insertion point moves
// after it. An edit that deletes the range's last character opens its end, so a
// retyped word stays covered: the end grows with each edit that starts right at
// it, and any other commit closes it.
function remapCommentRange(
  { endOffset, startOffset }: TextRange,
  edit: TextEdit,
  openEnd: boolean,
): { end: number; openEnd: boolean; start: number } {
  if (openEnd && edit.startOffset === endOffset) {
    return { end: endOffset + edit.insertedLength, openEnd, start: startOffset };
  }

  const insertion = edit.startOffset === edit.endOffset;
  const start = mapOffsetThroughTextEdit(startOffset, edit, insertion ? 1 : -1);
  const end = mapOffsetThroughTextEdit(endOffset, edit, insertion ? -1 : 1);

  return {
    end: Math.max(start, end),
    openEnd: startOffset < endOffset && edit.startOffset < endOffset && endOffset <= edit.endOffset,
    start,
  };
}
