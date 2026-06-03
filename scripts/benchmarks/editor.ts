import {
  createAnchorFromContainer,
  createCommentThread,
  createParagraphTextBlock,
  extractQuoteFromContainer,
  listAnchorContainers,
  markCommentThreadAsResolved,
} from "@/document";
import { getCommentState } from "@/editor/anchors";
import {
  copySelection,
  createDocumentFromEditorState,
  createEditorState,
  deleteBackward,
  insertLineBreak,
  insertText,
  pasteFragment,
  setSelection,
} from "@/editor/state";
import { dispatch } from "@/editor/state/reducer/state";
import { parseFragment, serializeDocument, serializeFragment } from "@/markdown";
import {
  createEditorLayoutState,
  findLineEntryForRegionOffset,
  findLineForRegionOffset,
  measureCaretTarget,
  resolveCaretVisualLeft,
  type DocumentLayout,
} from "@/editor/layout";
import { resolveEditorHitAtPoint } from "@/editor/navigation";
import { createLayoutCache } from "@/editor";
import type { BenchmarkBudgetTree, BenchmarkRecord } from "./shared";
import { runBudgetedBenchmark } from "./shared";

export function createEditorBenchmarks(
  budgets: BenchmarkBudgetTree["editor"],
  fixtures: {
    blockquoteTransitionSnapshot: Parameters<typeof createEditorState>[0];
    commentsSnapshot: Parameters<typeof createEditorState>[0];
    hugeSnapshot: Parameters<typeof createEditorState>[0];
    longSnapshot: Parameters<typeof createEditorState>[0];
    mediumMarkdown: string;
    mediumSnapshot: Parameters<typeof createEditorState>[0];
    nestedStructuralSnapshot: Parameters<typeof createEditorState>[0];
    richCodeSnapshot: Parameters<typeof createEditorState>[0];
    richTablesSnapshot: Parameters<typeof createEditorState>[0];
    sampleSnapshot: Parameters<typeof createEditorState>[0];
    xlargeSnapshot: Parameters<typeof createEditorState>[0];
  },
): BenchmarkRecord[] {
  const mediumState = createEditorState(fixtures.mediumSnapshot);
  const longState = createEditorState(fixtures.longSnapshot);
  const richCodeState = createEditorState(fixtures.richCodeSnapshot);
  const longEditingState = selectMiddleTextRegion(fixtures.longSnapshot);
  const commentIrrelevantTypingState = selectCanvasText(
    fixtures.commentsSnapshot,
    "Secondary bullet remains unannotated.",
    "Secondary bullet".length,
  );
  const longInteractionFixture = createLongInteractionFixture(fixtures.longSnapshot);
  const xlargeInteractionFixture = createLongInteractionFixture(fixtures.xlargeSnapshot);
  const hugeInteractionFixture = createLongInteractionFixture(fixtures.hugeSnapshot);
  const longSelectAllState = selectEntireDocument(fixtures.longSnapshot);
  const longCaretState = selectMiddleTextRegion(fixtures.longSnapshot);
  const denseInlinesSource = buildDenseInlinesSource();

  // Full-frame fixtures: a viewport + render cache shared by the
  // typing/backspace-with-layout benchmarks below. The viewport matches
  // the layout-only benchmarks so the layout slice is comparable.
  const fullFrameLayoutOptions = { height: 720, top: 0, width: 420 };
  const fullFrameLayoutCache = createLayoutCache();

  return [
    // --- Import / export lifecycle ---

    runBudgetedBenchmark(budgets, "editor_import_medium", 200, () => {
      void createEditorState(fixtures.mediumSnapshot);
    }),
    runBudgetedBenchmark(budgets, "editor_import", 100, () => {
      void createEditorState(fixtures.longSnapshot);
    }),
    runBudgetedBenchmark(budgets, "editor_import_rich", 200, () => {
      void createEditorState(fixtures.richTablesSnapshot);
    }),
    runBudgetedBenchmark(budgets, "editor_import_comments", 200, () => {
      void createEditorState(fixtures.commentsSnapshot);
    }),
    // Cold-build cost of `createCommentContainerIndex`: O(C × N) per thread
    // because each thread runs `resolveCommentThread` against the document.
    // Reuse via `document.comments` identity hides this on edits, but every
    // import / undo / external-content reload pays it once.
    runBudgetedBenchmark(budgets, "editor_import_comments_dense", 200, () => {
      const denseSnapshot = createDenseCommentSnapshot(fixtures.mediumSnapshot, 60);
      void createEditorState(denseSnapshot);
    }),
    runBudgetedBenchmark(budgets, "editor_export_medium", 200, () => {
      void createDocumentFromEditorState(mediumState);
    }),
    runBudgetedBenchmark(budgets, "editor_export", 100, () => {
      void createDocumentFromEditorState(longState);
    }),
    runBudgetedBenchmark(budgets, "editor_export_rich", 200, () => {
      void createDocumentFromEditorState(richCodeState);
    }),

    // --- Typing (insertText) ---

    runBudgetedBenchmark(budgets, "editor_typing_small", 200, () => {
      const editorState = selectCanvasText(
        fixtures.sampleSnapshot,
        "bootstrap",
        "bootstrap".length,
      );
      void insertText(editorState, " editor");
    }),
    runBudgetedBenchmark(budgets, "editor_typing_medium", 200, () => {
      const editorState = selectCanvasText(
        fixtures.mediumSnapshot,
        "Bullet item",
        "Bullet item".length,
      );
      void insertText(editorState, " updated");
    }),
    runBudgetedBenchmark(budgets, "editor_typing_long", 100, () => {
      void insertText(longEditingState, " updated");
    }),
    runBudgetedBenchmark(budgets, "editor_splice_blocks_long", 100, () => {
      void dispatch(longState, createMiddleRootReplacementAction(longState));
    }),
    // Full-frame: insertText + snapshot serialization + viewport layout.
    // Approximates the actual user-felt keystroke latency on a long doc.
    // Excludes paint, which would require a real canvas context.
    runBudgetedBenchmark(budgets, "editor_typing_long_full_frame", 100, () => {
      const nextState = insertText(longEditingState, " updated");
      if (!nextState) throw new Error("insertText returned null");
      void serializeDocument(nextState.documentIndex.document);
      void createEditorLayoutState(nextState, fullFrameLayoutOptions, fullFrameLayoutCache);
    }),
    runBudgetedBenchmark(budgets, "editor_typing_code", 200, () => {
      const editorState = selectCanvasText(
        fixtures.richCodeSnapshot,
        'return "stable";',
        'return "stable"'.length,
      );
      void insertText(editorState, " // stage-5");
    }),
    runBudgetedBenchmark(budgets, "editor_typing_table", 200, () => {
      const editorState = selectCanvasText(fixtures.richTablesSnapshot, "scrolls", 0);
      void insertText(editorState, "host-");
    }),
    runBudgetedBenchmark(budgets, "editor_typing_comments_elsewhere", 200, () => {
      void insertText(commentIrrelevantTypingState, " updated");
    }),

    // --- Backspace (deleteBackward) ---

    runBudgetedBenchmark(budgets, "editor_backspace_medium", 200, () => {
      const editorState = selectCanvasText(
        fixtures.blockquoteTransitionSnapshot,
        "closing line",
        0,
      );
      void deleteBackward(editorState);
    }),
    runBudgetedBenchmark(budgets, "editor_backspace_long", 100, () => {
      void deleteBackward(longEditingState);
    }),
    // Full-frame counterpart to editor_backspace_long. See typing_long_full_frame.
    runBudgetedBenchmark(budgets, "editor_backspace_long_full_frame", 100, () => {
      const nextState = deleteBackward(longEditingState);
      if (!nextState) return;
      void serializeDocument(nextState.documentIndex.document);
      void createEditorLayoutState(nextState, fullFrameLayoutOptions, fullFrameLayoutCache);
    }),

    // --- Enter (insertLineBreak) ---

    runBudgetedBenchmark(budgets, "editor_linebreak_medium", 200, () => {
      const editorState = selectCanvasText(fixtures.mediumSnapshot, "Bullet item", 3);
      void insertLineBreak(editorState);
    }),
    runBudgetedBenchmark(budgets, "editor_linebreak_list", 200, () => {
      const editorState = selectCanvasText(fixtures.nestedStructuralSnapshot, "gamma", 2);
      void insertLineBreak(editorState);
    }),

    // --- Comments ---

    runBudgetedBenchmark(budgets, "editor_comment_toggle_dense", 200, () => {
      const denseSnapshot = createDenseCommentSnapshot(fixtures.mediumSnapshot, 18);
      const editorState = createEditorState({
        ...denseSnapshot,
        comments: [
          markCommentThreadAsResolved(denseSnapshot.comments[0]!, true),
          ...denseSnapshot.comments.slice(1),
        ],
      });

      void getCommentState(editorState.documentIndex);
    }),
    runBudgetedBenchmark(budgets, "editor_comment_repair_dense", 100, () => {
      const editorState = selectCanvasText(
        createDenseCommentSnapshot(fixtures.mediumSnapshot, 18),
        "Bullet item",
        "Bullet ".length,
      );
      const mutatedState = insertText(editorState, "annotated ");

      if (!mutatedState) {
        throw new Error("Expected comment repair mutation");
      }

      void getCommentState(mutatedState.documentIndex);
    }),

    // --- Hit testing ---

    runBudgetedBenchmark(budgets, "editor_hit_test", 200, () => {
      const { layout, point, state } = longInteractionFixture;

      void resolveEditorHitAtPoint(layout, state, point);
    }),
    runBudgetedBenchmark(budgets, "editor_hit_test_xlarge", 100, () => {
      const { layout, point, state } = xlargeInteractionFixture;

      void resolveEditorHitAtPoint(layout, state, point);
    }),
    runBudgetedBenchmark(budgets, "editor_hit_test_huge", 50, () => {
      const { layout, point, state } = hugeInteractionFixture;

      void resolveEditorHitAtPoint(layout, state, point);
    }),

    // --- Cursor navigation ---

    runBudgetedBenchmark(budgets, "editor_cursor_move", 100, () => {
      const { layout } = longInteractionFixture;
      let state = longInteractionFixture.state;

      for (let step = 0; step < 25; step += 1) {
        const nextState = moveSelectionToNextLine(state, layout);

        if (!nextState) {
          break;
        }

        state = nextState;
      }
    }),
    runBudgetedBenchmark(budgets, "editor_cursor_move_xlarge", 50, () => {
      const { layout } = xlargeInteractionFixture;
      let state = xlargeInteractionFixture.state;

      for (let step = 0; step < 25; step += 1) {
        const nextState = moveSelectionToNextLine(state, layout);

        if (!nextState) {
          break;
        }

        state = nextState;
      }
    }),
    runBudgetedBenchmark(budgets, "editor_cursor_move_huge", 30, () => {
      const { layout } = hugeInteractionFixture;
      let state = hugeInteractionFixture.state;

      for (let step = 0; step < 25; step += 1) {
        const nextState = moveSelectionToNextLine(state, layout);

        if (!nextState) {
          break;
        }

        state = nextState;
      }
    }),

    // --- Clipboard ---

    // Copy on a long doc: select-all → extractFragment + serializeFragment.
    // Stresses the cross-root trim + serialize walk over every block.
    runBudgetedBenchmark(budgets, "editor_copy_long", 100, () => {
      const fragment = copySelection(longSelectAllState);

      if (fragment) {
        void serializeFragment(fragment);
      }
    }),

    // Paste a multi-block fragment (the medium fixture, ≈100 blocks) into
    // a long doc. Stresses parseFragment, the structural seam-merge over a
    // long doc, and the comment finalize after the splice.
    runBudgetedBenchmark(budgets, "editor_paste_blocks_long", 100, () => {
      const fragment = parseFragment(fixtures.mediumMarkdown);
      void pasteFragment(longCaretState, fragment, fixtures.mediumMarkdown);
    }),

    // Paste a single paragraph with many marked runs (≈100 inline nodes
    // interleaving bold / italic / code / link). Stresses spliceInlineNodes
    // and the inline-defragment pass that runs at the seams.
    runBudgetedBenchmark(budgets, "editor_paste_inlines_dense", 200, () => {
      const fragment = parseFragment(denseInlinesSource);
      void pasteFragment(longCaretState, fragment, denseInlinesSource);
    }),
  ];
}

// --- Benchmark helpers ---

function createDenseCommentSnapshot(
  snapshot: Parameters<typeof createEditorState>[0],
  count: number,
) {
  const containers = listAnchorContainers(snapshot);
  const primaryContainer = containers.find((container) => container.text.includes("Bullet item"));

  if (!primaryContainer) {
    return snapshot;
  }

  const comments = Array.from({ length: count }, (_, index) => {
    const startOffset = Math.min(index, Math.max(0, primaryContainer.text.length - 7));
    const endOffset = Math.min(primaryContainer.text.length, startOffset + 6);

    return createCommentThread({
      anchor: createAnchorFromContainer(primaryContainer, startOffset, endOffset),
      body: `Dense benchmark ${index + 1}`,
      createdAt: `2026-04-05T12:${String(index).padStart(2, "0")}:00.000Z`,
      quote: extractQuoteFromContainer(primaryContainer, startOffset, endOffset),
    });
  });

  return {
    ...snapshot,
    comments,
  };
}

function selectCanvasText(
  snapshot: Parameters<typeof createEditorState>[0],
  text: string,
  offset: number,
) {
  const state = createEditorState(snapshot);
  const container = state.documentIndex.regions.find((entry) => entry.text.includes(text));

  if (!container) {
    throw new Error(`Could not find canvas text: ${text}`);
  }

  return setSelection(state, {
    regionId: container.id,
    offset: container.text.indexOf(text) + offset,
  });
}

function selectMiddleTextRegion(snapshot: Parameters<typeof createEditorState>[0]) {
  const state = createEditorState(snapshot);
  const textRegions = state.documentIndex.regions.filter((region) => region.text.length > 0);
  const region = textRegions[Math.floor(textRegions.length / 2)];

  if (!region) {
    throw new Error("Expected non-empty editor region");
  }

  return setSelection(state, {
    regionId: region.id,
    offset: Math.floor(region.text.length / 2),
  });
}

function createMiddleRootReplacementAction(state: ReturnType<typeof createEditorState>) {
  const rootIndex = Math.floor(state.documentIndex.roots.length / 2);

  return {
    blocks: [createParagraphTextBlock(`Replacement root ${rootIndex}`)],
    count: 1,
    kind: "splice-blocks" as const,
    rootIndex,
    selection: null,
  };
}

function createLongInteractionFixture(snapshot: Parameters<typeof createEditorState>[0]) {
  const state = selectMiddleTextRegion(snapshot);
  const layoutCache = createLayoutCache();
  const layout = createEditorLayoutState(
    state,
    {
      height: 100_000,
      top: 0,
      width: 420,
    },
    layoutCache,
  ).layout;
  const line = findCurrentLine(state, layout);

  if (!line) {
    throw new Error("Expected current line for long interaction benchmark");
  }

  return {
    layout,
    point: {
      x: line.left + Math.max(8, line.width / 2),
      y: line.top + line.height / 2,
    },
    state,
  };
}

function moveSelectionToNextLine(
  state: ReturnType<typeof createEditorState>,
  layout: DocumentLayout,
) {
  const caret = measureCaretTarget(layout, state.documentIndex, {
    regionId: state.selection.focus.regionId,
    offset: state.selection.focus.offset,
  });
  const currentLine = findCurrentLine(state, layout);

  if (!caret || !currentLine) {
    return null;
  }

  const currentLineEntry = findLineEntryForRegionOffset(
    layout,
    currentLine.regionId,
    state.selection.focus.offset,
  );
  const targetLine = currentLineEntry ? layout.lines[currentLineEntry.index + 1] : null;

  if (!targetLine) {
    return null;
  }

  const hit = resolveEditorHitAtPoint(layout, state, {
    x: resolveCaretVisualLeft(state, layout, caret) + 1,
    y: targetLine.top + targetLine.height / 2,
  });

  return hit
    ? setSelection(state, {
        regionId: hit.regionId,
        offset: hit.offset,
      })
    : null;
}

function findCurrentLine(state: ReturnType<typeof createEditorState>, layout: DocumentLayout) {
  return findLineForRegionOffset(
    layout,
    state.selection.focus.regionId,
    state.selection.focus.offset,
  );
}

function selectEntireDocument(snapshot: Parameters<typeof createEditorState>[0]) {
  const state = createEditorState(snapshot);
  const first = state.documentIndex.regions[0];
  const last = state.documentIndex.regions.at(-1);

  if (!first || !last) {
    throw new Error("Expected a non-empty document for select-all benchmark");
  }

  return setSelection(state, {
    anchor: { regionId: first.id, offset: 0 },
    focus: { regionId: last.id, offset: last.text.length },
  });
}

// A single paragraph alternating across every inline kind (text, bold,
// italic, code, link, image) so the inline-splice path has to walk and
// merge a dense, heterogeneous run list.
function buildDenseInlinesSource() {
  const segments: string[] = [];

  for (let index = 0; index < 25; index += 1) {
    segments.push(
      `lorem-${index}`,
      `**bold-${index}**`,
      `*italic-${index}*`,
      `\`code-${index}\``,
      `[link-${index}](https://example.com/${index})`,
    );
  }

  return segments.join(" ");
}
