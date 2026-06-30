import { indexedTextEntries } from "@test/editor/helpers";
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
  normalizeSelection,
  pasteFragment,
  resolveIndexedBlockContainingPath,
  setSelection,
} from "@/editor/state";
import { dispatch } from "@/editor/state/reducer/state";
import { parseDocument, parseFragment, serializeDocument, serializeFragment } from "@/markdown";
import {
  createEditorLayoutState,
  findLineEntryForPathOffset,
  findLineForPathOffset,
  measureCaretTarget,
  resolveCaretVisualLeft,
  type DocumentLayout,
} from "@/editor/layout";
import { resolveEditorHitAtPoint } from "@/editor/navigation";
import { createLayoutCache } from "@/editor";
import { lightTheme, resolveEditorTheme } from "@/component/lib/themes";
import { createDocumentFrame } from "@/renderer";
import {
  BENCHMARK_VIEWPORT,
  FULL_DOCUMENT_VIEWPORT_HEIGHT,
  type BenchmarkScenario,
} from "../harness";
import { createBenchmarkScenario } from "../harness";

export function createEditorScenarios(fixtures: {
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
}): BenchmarkScenario[] {
  const mediumState = createEditorState(fixtures.mediumSnapshot);
  const longState = createEditorState(fixtures.longSnapshot);
  const richCodeState = createEditorState(fixtures.richCodeSnapshot);
  const longEditingState = selectMiddleTextPath(fixtures.longSnapshot);
  const commentIrrelevantTypingState = selectCanvasText(
    fixtures.commentsSnapshot,
    "Secondary bullet remains unannotated.",
    "Secondary bullet".length,
  );
  const longInteractionFixture = createLongInteractionFixture(fixtures.longSnapshot);
  const xlargeInteractionFixture = createLongInteractionFixture(fixtures.xlargeSnapshot);
  const hugeInteractionFixture = createLongInteractionFixture(fixtures.hugeSnapshot);
  const longSelectAllState = selectEntireDocument(fixtures.longSnapshot);
  const longCaretState = selectMiddleTextPath(fixtures.longSnapshot);
  const denseInlinesSource = buildDenseInlinesSource();

  // Full-frame fixtures: a viewport + render cache shared by the
  // typing/backspace-with-layout benchmarks below. The viewport matches
  // the layout-only benchmarks so the layout slice is comparable.
  const fullFrameLayoutOptions = { ...BENCHMARK_VIEWPORT, top: 0 };
  const fullFrameLayoutCache = createLayoutCache();
  const frameTheme = resolveEditorTheme(lightTheme);
  const frameLayoutState = createEditorLayoutState(
    longCaretState,
    fullFrameLayoutOptions,
    createLayoutCache(),
  );
  const tableFrameState = selectCanvasText(fixtures.richTablesSnapshot, "scrolls", 0);
  const tableFrameLayoutState = createEditorLayoutState(
    tableFrameState,
    fullFrameLayoutOptions,
    createLayoutCache(),
  );
  const denseTableFrameState = createDenseTableFrameState();
  const denseTableFrameLayoutState = createEditorLayoutState(
    denseTableFrameState,
    fullFrameLayoutOptions,
    createLayoutCache(),
  );

  return [
    // --- Import / export lifecycle ---

    createBenchmarkScenario("editor", "editor_import_medium", 200, () => {
      void createEditorState(fixtures.mediumSnapshot);
    }),
    createBenchmarkScenario("editor", "editor_import", 100, () => {
      void createEditorState(fixtures.longSnapshot);
    }),
    createBenchmarkScenario("editor", "editor_import_rich", 200, () => {
      void createEditorState(fixtures.richTablesSnapshot);
    }),
    createBenchmarkScenario("editor", "editor_import_comments", 200, () => {
      void createEditorState(fixtures.commentsSnapshot);
    }),
    // Cold-build cost of `createCommentContainerIndex`: O(C × N) per thread
    // because each thread runs `resolveCommentThread` against the document.
    // Reuse via `document.comments` identity hides this on edits, but every
    // import / undo / external-content reload pays it once.
    createBenchmarkScenario("editor", "editor_import_comments_dense", 200, () => {
      const denseSnapshot = createDenseCommentSnapshot(fixtures.mediumSnapshot, 60);
      void createEditorState(denseSnapshot);
    }),
    createBenchmarkScenario("editor", "editor_export_medium", 200, () => {
      void createDocumentFromEditorState(mediumState);
    }),
    createBenchmarkScenario("editor", "editor_export", 100, () => {
      void createDocumentFromEditorState(longState);
    }),
    createBenchmarkScenario("editor", "editor_export_rich", 200, () => {
      void createDocumentFromEditorState(richCodeState);
    }),

    // --- Typing (insertText) ---

    createBenchmarkScenario("editor", "editor_typing_small", 200, () => {
      const editorState = selectCanvasText(
        fixtures.sampleSnapshot,
        "bootstrap",
        "bootstrap".length,
      );
      void insertText(editorState, " editor");
    }),
    createBenchmarkScenario("editor", "editor_typing_medium", 200, () => {
      const editorState = selectCanvasText(
        fixtures.mediumSnapshot,
        "Bullet item",
        "Bullet item".length,
      );
      void insertText(editorState, " updated");
    }),
    createBenchmarkScenario("editor", "editor_typing_long", 100, () => {
      void insertText(longEditingState, " updated");
    }),
    createBenchmarkScenario("editor", "editor_splice_blocks_long", 100, () => {
      void dispatch(longState, createMiddleRootReplacementAction(longState));
    }),
    // Full-frame: insertText + snapshot serialization + viewport layout.
    // Approximates the actual user-felt keystroke latency on a long doc.
    // Excludes paint, which would require a real canvas context.
    createBenchmarkScenario("editor", "editor_typing_long_full_frame", 100, () => {
      const nextState = insertText(longEditingState, " updated");
      if (!nextState) throw new Error("insertText returned null");
      void serializeDocument(nextState.documentIndex.document);
      void createEditorLayoutState(nextState, fullFrameLayoutOptions, fullFrameLayoutCache);
    }),
    createBenchmarkScenario("editor", "editor_create_document_frame_long", 200, () => {
      void createDocumentFrame(longCaretState, frameLayoutState, {
        activeBlockPath:
          resolveIndexedBlockContainingPath(longCaretState.documentIndex, longCaretState.selection.focus.path)
            ?.path ?? null,
        activePath: longCaretState.selection.focus.path,
        activeThreadIndex: null,
        commentRanges: [],
        devicePixelRatio: 1,
        height: BENCHMARK_VIEWPORT.height,
        normalizedSelection: normalizeSelection(longCaretState),
        now: 0,
        theme: frameTheme,
        width: BENCHMARK_VIEWPORT.width,
      });
    }),
    createBenchmarkScenario("editor", "editor_create_document_frame_table", 200, () => {
      void createDocumentFrame(tableFrameState, tableFrameLayoutState, {
        activeBlockPath:
          resolveIndexedBlockContainingPath(
            tableFrameState.documentIndex,
            tableFrameState.selection.focus.path,
          )?.path ?? null,
        activePath: tableFrameState.selection.focus.path,
        activeThreadIndex: null,
        commentRanges: [],
        devicePixelRatio: 1,
        height: BENCHMARK_VIEWPORT.height,
        normalizedSelection: normalizeSelection(tableFrameState),
        now: 0,
        theme: frameTheme,
        width: BENCHMARK_VIEWPORT.width,
      });
    }),
    createBenchmarkScenario("editor", "editor_create_document_frame_dense_table_selection", 200, () => {
      void createDocumentFrame(denseTableFrameState, denseTableFrameLayoutState, {
        activeBlockPath:
          resolveIndexedBlockContainingPath(
            denseTableFrameState.documentIndex,
            denseTableFrameState.selection.focus.path,
          )?.path ?? null,
        activePath: denseTableFrameState.selection.focus.path,
        activeThreadIndex: null,
        commentRanges: [],
        devicePixelRatio: 1,
        height: BENCHMARK_VIEWPORT.height,
        normalizedSelection: normalizeSelection(denseTableFrameState),
        now: 0,
        theme: frameTheme,
        width: BENCHMARK_VIEWPORT.width,
      });
    }),
    createBenchmarkScenario("editor", "editor_typing_code", 200, () => {
      const editorState = selectCanvasText(
        fixtures.richCodeSnapshot,
        'return "stable";',
        'return "stable"'.length,
      );
      void insertText(editorState, " // stage-5");
    }),
    createBenchmarkScenario("editor", "editor_typing_table", 200, () => {
      const editorState = selectCanvasText(fixtures.richTablesSnapshot, "scrolls", 0);
      void insertText(editorState, "host-");
    }),
    createBenchmarkScenario("editor", "editor_typing_comments_elsewhere", 200, () => {
      void insertText(commentIrrelevantTypingState, " updated");
    }),

    // --- Backspace (deleteBackward) ---

    createBenchmarkScenario("editor", "editor_backspace_medium", 200, () => {
      const editorState = selectCanvasText(
        fixtures.blockquoteTransitionSnapshot,
        "closing line",
        0,
      );
      void deleteBackward(editorState);
    }),
    createBenchmarkScenario("editor", "editor_backspace_long", 100, () => {
      void deleteBackward(longEditingState);
    }),
    // Full-frame counterpart to editor_backspace_long. See typing_long_full_frame.
    createBenchmarkScenario("editor", "editor_backspace_long_full_frame", 200, () => {
      const nextState = deleteBackward(longEditingState);
      if (!nextState) return;
      void serializeDocument(nextState.documentIndex.document);
      void createEditorLayoutState(nextState, fullFrameLayoutOptions, fullFrameLayoutCache);
    }),

    // --- Enter (insertLineBreak) ---

    createBenchmarkScenario("editor", "editor_linebreak_medium", 200, () => {
      const editorState = selectCanvasText(fixtures.mediumSnapshot, "Bullet item", 3);
      void insertLineBreak(editorState);
    }),
    createBenchmarkScenario("editor", "editor_linebreak_list", 200, () => {
      const editorState = selectCanvasText(fixtures.nestedStructuralSnapshot, "gamma", 2);
      void insertLineBreak(editorState);
    }),

    // --- Comments ---

    createBenchmarkScenario("editor", "editor_comment_toggle_dense", 200, () => {
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
    createBenchmarkScenario("editor", "editor_comment_repair_dense", 100, () => {
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

    createBenchmarkScenario("editor", "editor_hit_test", 200, () => {
      const { layout, point, state } = longInteractionFixture;

      void resolveEditorHitAtPoint(layout, state, point);
    }),
    createBenchmarkScenario("editor", "editor_hit_test_xlarge", 100, () => {
      const { layout, point, state } = xlargeInteractionFixture;

      void resolveEditorHitAtPoint(layout, state, point);
    }),
    createBenchmarkScenario("editor", "editor_hit_test_huge", 50, () => {
      const { layout, point, state } = hugeInteractionFixture;

      void resolveEditorHitAtPoint(layout, state, point);
    }),

    // --- Cursor navigation ---

    createBenchmarkScenario(
      "editor",
      "editor_cursor_move",
      100,
      () => {
        const { layout } = longInteractionFixture;
        let state = longInteractionFixture.state;

        for (let step = 0; step < 25; step += 1) {
          const nextState = moveSelectionToNextLine(state, layout);

          if (!nextState) {
            break;
          }

          state = nextState;
        }
      },
    ),
    createBenchmarkScenario(
      "editor",
      "editor_cursor_move_xlarge",
      50,
      () => {
        const { layout } = xlargeInteractionFixture;
        let state = xlargeInteractionFixture.state;

        for (let step = 0; step < 25; step += 1) {
          const nextState = moveSelectionToNextLine(state, layout);

          if (!nextState) {
            break;
          }

          state = nextState;
        }
      },
    ),
    createBenchmarkScenario(
      "editor",
      "editor_cursor_move_huge",
      200,
      () => {
        const { layout } = hugeInteractionFixture;
        let state = hugeInteractionFixture.state;

        for (let step = 0; step < 25; step += 1) {
          const nextState = moveSelectionToNextLine(state, layout);

          if (!nextState) {
            break;
          }

          state = nextState;
        }
      },
    ),

    // --- Clipboard ---

    // Copy on a long doc: select-all → extractFragment + serializeFragment.
    // Stresses the cross-root trim + serialize walk over every block.
    createBenchmarkScenario("editor", "editor_copy_long", 100, () => {
      const fragment = copySelection(longSelectAllState);

      if (fragment) {
        void serializeFragment(fragment);
      }
    }),

    // Paste a multi-block fragment (the medium fixture, ≈100 blocks) into
    // a long doc. Stresses parseFragment, the structural merge at the splice
    // boundary, and the comment finalize after the splice.
    createBenchmarkScenario("editor", "editor_paste_blocks_long", 100, () => {
      const fragment = parseFragment(fixtures.mediumMarkdown);
      void pasteFragment(longCaretState, fragment, fixtures.mediumMarkdown);
    }),

    // Paste a single paragraph with many marked runs (≈100 inline nodes
    // interleaving bold / italic / code / link). Stresses spliceInlineNodes
    // and the inline-defragment pass at the splice boundaries.
    createBenchmarkScenario("editor", "editor_paste_inlines_dense", 200, () => {
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
  const container = indexedTextEntries(state).find((entry) => entry.text.includes(text));

  if (!container) {
    throw new Error(`Could not find canvas text: ${text}`);
  }

  return setSelection(state, {
    path: container.path,
    offset: container.text.indexOf(text) + offset,
  });
}

function selectMiddleTextPath(snapshot: Parameters<typeof createEditorState>[0]) {
  const state = createEditorState(snapshot);
  const textPaths = indexedTextEntries(state).filter((path) => path.text.length > 0);
  const path = textPaths[Math.floor(textPaths.length / 2)];

  if (!path) {
    throw new Error("Expected non-empty editor path");
  }

  return setSelection(state, {
    path: path.path,
    offset: Math.floor(path.text.length / 2),
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
  const state = selectMiddleTextPath(snapshot);
  const layoutCache = createLayoutCache();
  const layout = createEditorLayoutState(
    state,
    {
      height: FULL_DOCUMENT_VIEWPORT_HEIGHT,
      top: 0,
      width: BENCHMARK_VIEWPORT.width,
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
    path: state.selection.focus.path,
    offset: state.selection.focus.offset,
  });
  const currentLine = findCurrentLine(state, layout);

  if (!caret || !currentLine) {
    return null;
  }

  const currentLineEntry = findLineEntryForPathOffset(
    layout,
    currentLine.path,
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
        path: hit.path,
        offset: hit.offset,
      })
    : null;
}

function findCurrentLine(state: ReturnType<typeof createEditorState>, layout: DocumentLayout) {
  return findLineForPathOffset(
    layout,
    state.selection.focus.path,
    state.selection.focus.offset,
  );
}

function selectEntireDocument(snapshot: Parameters<typeof createEditorState>[0]) {
  const state = createEditorState(snapshot);
  const first = indexedTextEntries(state)[0];
  const last = indexedTextEntries(state).at(-1);

  if (!first || !last) {
    throw new Error("Expected a non-empty document for select-all benchmark");
  }

  return setSelection(state, {
    anchor: { path: first.path, offset: 0 },
    focus: { path: last.path, offset: last.text.length },
  });
}

function createDenseTableFrameState() {
  const state = createEditorState(parseDocument(buildDenseTableMarkdown(48, 12)));
  const cells = indexedTextEntries(state).filter((entry) => entry.tableCell);
  const firstBodyCell = cells.find((entry) => entry.tableCell?.rowIndex === 1);
  const lastBodyCell = cells.at(-1);

  if (!firstBodyCell || !lastBodyCell) {
    throw new Error("Expected dense table cells for frame benchmark");
  }

  return setSelection(state, {
    anchor: { path: firstBodyCell.path, offset: 0 },
    focus: { path: lastBodyCell.path, offset: lastBodyCell.text.length },
  });
}

function buildDenseTableMarkdown(rowCount: number, columnCount: number) {
  const header = Array.from({ length: columnCount }, (_, index) => `H${index}`).join(" | ");
  const separator = Array.from({ length: columnCount }, () => "-").join(" | ");
  const body = Array.from({ length: rowCount }, (_, rowIndex) =>
    Array.from({ length: columnCount }, (_, columnIndex) => `R${rowIndex}C${columnIndex}`).join(
      " | ",
    ),
  );

  return [`| ${header} |`, `| ${separator} |`, ...body.map((row) => `| ${row} |`)].join("\n");
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
