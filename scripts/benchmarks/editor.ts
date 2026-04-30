import {
  createAnchorFromContainer,
  createCommentThread,
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
import { parseFragment, serializeFragment } from "@/markdown";
import {
  createDocumentLayout,
  findLineEntryForRegionOffset,
  findLineForRegionOffset,
  measureCaretTarget,
  resolveCaretVisualLeft,
  resolveEditorHitAtPoint,
  type ViewportLayout,
} from "@/editor/layout";
import { createCanvasRenderCache } from "@/editor/canvas/cache";
import type { BenchmarkBudgetTree, BenchmarkRecord } from "./shared";
import { runBenchmark } from "./shared";

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

  return [
    // --- Import / export lifecycle ---

    runBenchmark("editor_import_medium", 50, budgets.import_medium, () => {
      void createEditorState(fixtures.mediumSnapshot);
    }),
    runBenchmark("editor_import", 20, budgets.import, () => {
      void createEditorState(fixtures.longSnapshot);
    }),
    runBenchmark("editor_import_rich", 50, budgets.import_rich, () => {
      void createEditorState(fixtures.richTablesSnapshot);
    }),
    runBenchmark("editor_import_comments", 50, budgets.import_comments, () => {
      void createEditorState(fixtures.commentsSnapshot);
    }),
    runBenchmark("editor_export_medium", 50, budgets.export_medium, () => {
      void createDocumentFromEditorState(mediumState);
    }),
    runBenchmark("editor_export", 20, budgets.export, () => {
      void createDocumentFromEditorState(longState);
    }),
    runBenchmark("editor_export_rich", 50, budgets.export_rich, () => {
      void createDocumentFromEditorState(richCodeState);
    }),

    // --- Typing (insertText) ---

    runBenchmark("editor_typing_small", 50, budgets.typing_small, () => {
      const editorState = selectCanvasText(
        fixtures.sampleSnapshot,
        "bootstrap",
        "bootstrap".length,
      );
      void insertText(editorState, " editor");
    }),
    runBenchmark("editor_typing_medium", 50, budgets.typing_medium, () => {
      const editorState = selectCanvasText(
        fixtures.mediumSnapshot,
        "Bullet item",
        "Bullet item".length,
      );
      void insertText(editorState, " updated");
    }),
    runBenchmark("editor_typing_long", 20, budgets.typing_long, () => {
      void insertText(longEditingState, " updated");
    }),
    runBenchmark("editor_typing_code", 50, budgets.typing_code, () => {
      const editorState = selectCanvasText(
        fixtures.richCodeSnapshot,
        'return "stable";',
        'return "stable"'.length,
      );
      void insertText(editorState, " // stage-5");
    }),
    runBenchmark("editor_typing_table", 50, budgets.typing_table, () => {
      const editorState = selectCanvasText(fixtures.richTablesSnapshot, "scrolls", 0);
      void insertText(editorState, "host-");
    }),
    runBenchmark("editor_typing_comments_elsewhere", 50, budgets.typing_comments_elsewhere, () => {
      void insertText(commentIrrelevantTypingState, " updated");
    }),

    // --- Backspace (deleteBackward) ---

    runBenchmark("editor_backspace_medium", 50, budgets.backspace_medium, () => {
      const editorState = selectCanvasText(
        fixtures.blockquoteTransitionSnapshot,
        "closing line",
        0,
      );
      void deleteBackward(editorState);
    }),
    runBenchmark("editor_backspace_long", 20, budgets.backspace_long, () => {
      void deleteBackward(longEditingState);
    }),

    // --- Enter (insertLineBreak) ---

    runBenchmark("editor_linebreak_medium", 50, budgets.linebreak_medium, () => {
      const editorState = selectCanvasText(fixtures.mediumSnapshot, "Bullet item", 3);
      void insertLineBreak(editorState);
    }),
    runBenchmark("editor_linebreak_list", 50, budgets.linebreak_list, () => {
      const editorState = selectCanvasText(fixtures.nestedStructuralSnapshot, "gamma", 2);
      void insertLineBreak(editorState);
    }),

    // --- Comments ---

    runBenchmark("editor_comment_toggle_dense", 50, budgets.comment_toggle_dense, () => {
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
    runBenchmark("editor_comment_repair_dense", 20, budgets.comment_repair_dense, () => {
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

    runBenchmark("editor_hit_test", 50, budgets.hit_test, () => {
      const { layout, point, state } = longInteractionFixture;

      void resolveEditorHitAtPoint(layout, state, point);
    }),
    runBenchmark("editor_hit_test_xlarge", 20, budgets.hit_test_xlarge, () => {
      const { layout, point, state } = xlargeInteractionFixture;

      void resolveEditorHitAtPoint(layout, state, point);
    }),
    runBenchmark("editor_hit_test_huge", 10, budgets.hit_test_huge, () => {
      const { layout, point, state } = hugeInteractionFixture;

      void resolveEditorHitAtPoint(layout, state, point);
    }),

    // --- Cursor navigation ---

    runBenchmark("editor_cursor_move", 20, budgets.cursor_move, () => {
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
    runBenchmark("editor_cursor_move_xlarge", 10, budgets.cursor_move_xlarge, () => {
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
    runBenchmark("editor_cursor_move_huge", 6, budgets.cursor_move_huge, () => {
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
    runBenchmark("editor_copy_long", 20, budgets.copy_long, () => {
      const fragment = copySelection(longSelectAllState);

      if (fragment) {
        void serializeFragment(fragment);
      }
    }),

    // Paste a multi-block fragment (the medium fixture, ≈100 blocks) into
    // a long doc. Stresses parseFragment, the structural seam-merge over a
    // long doc, and the comment finalize after the splice.
    runBenchmark("editor_paste_blocks_long", 20, budgets.paste_blocks_long, () => {
      const fragment = parseFragment(fixtures.mediumMarkdown);
      void pasteFragment(longCaretState, fragment, fixtures.mediumMarkdown);
    }),

    // Paste a single paragraph with many marked runs (≈100 inline nodes
    // interleaving bold / italic / code / link). Stresses spliceInlineNodes
    // and the inline-defragment pass that runs at the seams.
    runBenchmark("editor_paste_inlines_dense", 50, budgets.paste_inlines_dense, () => {
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

function createLongInteractionFixture(snapshot: Parameters<typeof createEditorState>[0]) {
  const state = selectMiddleTextRegion(snapshot);
  const renderCache = createCanvasRenderCache();
  const layout = createDocumentLayout(
    state.documentIndex,
    {
      width: 420,
    },
    renderCache,
  );
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
  layout: ViewportLayout,
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

function findCurrentLine(state: ReturnType<typeof createEditorState>, layout: ViewportLayout) {
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
