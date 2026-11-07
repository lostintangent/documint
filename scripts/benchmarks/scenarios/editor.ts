import { indexedTextEntries } from "@test/editor/helpers";
import {
  captureTextAnchor,
  createCommentThread,
  createParagraphTextBlock,
  listAnchorContainers,
  markCommentThreadAsResolved,
  type Document,
} from "@/document";
import { getCommentState } from "@/editor/anchors";
import {
  copySelection,
  createEditorState,
  deleteBackward,
  insertLineBreak,
  insertTableRow,
  insertText,
  metadataValuePath,
  pasteFragment,
  setSelection,
  type EditorState,
} from "@/editor/state";
import { dispatch } from "@/editor/state/reducer/state";
import { parseDocument, parseFragment, serializeDocument, serializeFragment } from "@/markdown";
import {
  createEditorLayoutState,
  findLineEntryForPathOffset,
  findLineForPathOffset,
  measureCaretTarget,
  resolveCaretHitTestX,
  type DocumentLayout,
} from "@/editor/layout";
import { resolveEditorHitAtPoint } from "@/editor/navigation";
import { createLayoutCache } from "@/editor";
import type { BenchmarkFixtures } from "../fixtures";
import {
  BENCHMARK_VIEWPORT,
  createBenchmarkDocumentFrame,
  createBenchmarkScenario,
  type BenchmarkScenario,
} from "../harness";

// Lays out the whole document at once, so interaction benchmarks never hit an
// estimated block.
const FULL_DOCUMENT_VIEWPORT_HEIGHT = 100_000;

export function createEditorScenarios(fixtures: BenchmarkFixtures): BenchmarkScenario[] {
  const longState = createEditorState(fixtures.longSnapshot);
  const longEditingState = selectMiddleTextPath(fixtures.longSnapshot);
  const commentIrrelevantTypingState = selectCanvasText(
    fixtures.commentsSnapshot,
    "Secondary bullet remains unannotated.",
    "Secondary bullet".length,
  );
  const commentedTypingState = selectCanvasText(
    createSpreadCommentSnapshot(fixtures.paragraphsLongSnapshot, 10),
    "Paragraph 500 ",
    "Paragraph 500 discusses top".length,
  );
  void getCommentState(commentedTypingState.documentIndex);
  const tableCopyTypingState = createRepeatedCellCommentState(200, 10);
  void getCommentState(tableCopyTypingState.documentIndex);
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
  const metadataFullFrameLayoutCache = createLayoutCache();
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
  const tablesEditing = createTablesEditingFixture(fixtures.tablesLongSnapshot);
  const metadataTypingState = setSelection(createEditorState(fixtures.metadataSnapshot), {
    anchor: { path: metadataValuePath(0), offset: 0 },
    focus: { path: metadataValuePath(0), offset: "Benchmark".length },
  });

  return [
    // --- Import / export lifecycle ---

    createBenchmarkScenario("editor_import_medium", 200, () => {
      void createEditorState(fixtures.mediumSnapshot);
    }),
    createBenchmarkScenario("editor_import", 100, () => {
      void createEditorState(fixtures.longSnapshot);
    }),
    createBenchmarkScenario("editor_import_rich", 200, () => {
      void createEditorState(fixtures.richTablesSnapshot);
    }),
    createBenchmarkScenario("editor_import_comments", 200, () => {
      void createEditorState(fixtures.commentsSnapshot);
    }),
    // Import with many threads on one paragraph. The editor state doesn't
    // resolve comments, so this guards against comment work creeping into
    // import / undo / external-content reload.
    createBenchmarkScenario("editor_import_comments_dense", 200, () => {
      const denseSnapshot = createDenseCommentSnapshot(fixtures.mediumSnapshot, 60);
      void createEditorState(denseSnapshot);
    }),

    // --- Typing (insertText) ---

    createBenchmarkScenario("editor_typing_small", 200, () => {
      const editorState = selectCanvasText(
        fixtures.sampleSnapshot,
        "bootstrap",
        "bootstrap".length,
      );
      void insertText(editorState, " editor");
    }),
    createBenchmarkScenario("editor_typing_medium", 200, () => {
      const editorState = selectCanvasText(
        fixtures.mediumSnapshot,
        "Bullet item",
        "Bullet item".length,
      );
      void insertText(editorState, " updated");
    }),
    createBenchmarkScenario("editor_typing_long", 100, () => {
      void insertText(longEditingState, " updated");
    }),
    createBenchmarkScenario("editor_splice_blocks_long", 100, () => {
      void dispatch(longState, createMiddleRootReplacementAction(longState));
    }),
    // Full-frame: insertText + snapshot serialization + viewport layout.
    // Approximates the actual user-felt keystroke latency on a long doc.
    // Excludes paint, which would require a real canvas context.
    createBenchmarkScenario("editor_typing_long_full_frame", 100, () => {
      const nextState = insertText(longEditingState, " updated");
      if (!nextState) throw new Error("insertText returned null");
      void serializeDocument(nextState.documentIndex.document);
      void createEditorLayoutState(nextState, fullFrameLayoutOptions, fullFrameLayoutCache);
    }),
    createBenchmarkScenario("editor_create_document_frame_long", 200, () => {
      void createBenchmarkDocumentFrame(longCaretState, frameLayoutState);
    }),
    createBenchmarkScenario("editor_create_document_frame_table", 200, () => {
      void createBenchmarkDocumentFrame(tableFrameState, tableFrameLayoutState);
    }),
    createBenchmarkScenario("editor_create_document_frame_dense_table_selection", 200, () => {
      void createBenchmarkDocumentFrame(denseTableFrameState, denseTableFrameLayoutState);
    }),
    createBenchmarkScenario("editor_typing_code", 200, () => {
      const editorState = selectCanvasText(
        fixtures.richCodeSnapshot,
        'return "stable";',
        'return "stable"'.length,
      );
      void insertText(editorState, " // stage-5");
    }),
    createBenchmarkScenario("editor_typing_table", 200, () => {
      const editorState = selectCanvasText(fixtures.richTablesSnapshot, "scrolls", 0);
      void insertText(editorState, "host-");
    }),
    // Full-frame typing in a mid-document table cell after the whole document
    // was scrolled once, so every keystroke rebuilds the virtual layout over
    // measured table rows.
    createBenchmarkScenario("editor_typing_tables_long_full_frame", 100, () => {
      const nextState = insertText(tablesEditing.cellState, "host-");
      if (!nextState) throw new Error("insertText returned null");
      void serializeDocument(nextState.documentIndex.document);
      void createEditorLayoutState(nextState, tablesEditing.viewport, tablesEditing.cache);
    }),
    createBenchmarkScenario("editor_typing_metadata_full_frame", 200, () => {
      const nextState = insertText(metadataTypingState, "Updated");
      if (!nextState) throw new Error("insertText returned null");
      void serializeDocument(nextState.documentIndex.document);
      const layoutState = createEditorLayoutState(
        nextState,
        {
          ...fullFrameLayoutOptions,
          metadataExpanded: true,
        },
        metadataFullFrameLayoutCache,
      );
      void createBenchmarkDocumentFrame(nextState, layoutState, BENCHMARK_VIEWPORT, null);
    }),
    createBenchmarkScenario("editor_typing_comments_elsewhere", 200, () => {
      void insertText(commentIrrelevantTypingState, " updated");
    }),
    // Typing inside one of many commented paragraphs, then the comment state
    // the host reads for every commit. The commit carries each thread's match
    // forward, so the read stays local to the edited paragraph.
    createBenchmarkScenario("editor_typing_comments_long", 200, () => {
      const nextState = insertText(commentedTypingState, "x");
      if (!nextState) throw new Error("insertText returned null");
      void getCommentState(nextState.documentIndex);
    }),
    // Completing a copy of commented table text, so every comment on that
    // text recounts which copy it sits on.
    createBenchmarkScenario("editor_typing_comments_table", 200, () => {
      const nextState = insertText(tableCopyTypingState, "s");
      if (!nextState) throw new Error("insertText returned null");
      void getCommentState(nextState.documentIndex);
    }),
    // Inserting a row in the middle of that table, so every comment below it
    // proves its cell moved, and every comment recounts which copy it sits on.
    createBenchmarkScenario("editor_table_row_insert_comments", 200, () => {
      const nextState = insertTableRow(tableCopyTypingState, "above");
      if (!nextState) throw new Error("insertTableRow returned null");
      void getCommentState(nextState.documentIndex);
    }),

    // --- Backspace (deleteBackward) ---

    createBenchmarkScenario("editor_backspace_medium", 200, () => {
      const editorState = selectCanvasText(
        fixtures.blockquoteTransitionSnapshot,
        "closing line",
        0,
      );
      void deleteBackward(editorState);
    }),
    createBenchmarkScenario("editor_backspace_long", 100, () => {
      void deleteBackward(longEditingState);
    }),
    // Full-frame counterpart to editor_backspace_long. See typing_long_full_frame.
    createBenchmarkScenario("editor_backspace_long_full_frame", 200, () => {
      const nextState = deleteBackward(longEditingState);
      if (!nextState) return;
      void serializeDocument(nextState.documentIndex.document);
      void createEditorLayoutState(nextState, fullFrameLayoutOptions, fullFrameLayoutCache);
    }),

    // --- Enter (insertLineBreak) ---

    createBenchmarkScenario("editor_linebreak_medium", 200, () => {
      const editorState = selectCanvasText(fixtures.mediumSnapshot, "Bullet item", 3);
      void insertLineBreak(editorState);
    }),
    createBenchmarkScenario("editor_linebreak_list", 200, () => {
      const editorState = selectCanvasText(fixtures.nestedStructuralSnapshot, "gamma", 2);
      void insertLineBreak(editorState);
    }),
    // Enter near the top of a table-heavy document re-paths every later root,
    // so the rebuild must find unchanged blocks and cells by content.
    createBenchmarkScenario("editor_linebreak_tables_long_full_frame", 100, () => {
      const nextState = insertLineBreak(tablesEditing.lineBreakState);
      if (!nextState) throw new Error("insertLineBreak returned null");
      void serializeDocument(nextState.documentIndex.document);
      void createEditorLayoutState(nextState, tablesEditing.viewport, tablesEditing.cache);
    }),

    // --- Comments ---

    createBenchmarkScenario("editor_comment_toggle_dense", 200, () => {
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
    createBenchmarkScenario("editor_comment_repair_dense", 100, () => {
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

    ...[
      { id: "editor_hit_test", iterations: 200, fixture: longInteractionFixture },
      { id: "editor_hit_test_xlarge", iterations: 100, fixture: xlargeInteractionFixture },
      { id: "editor_hit_test_huge", iterations: 50, fixture: hugeInteractionFixture },
    ].map(({ fixture, id, iterations }) =>
      createBenchmarkScenario(id, iterations, () => {
        const { layout, point, state } = fixture;

        void resolveEditorHitAtPoint(layout, state, point);
      }),
    ),

    // --- Cursor navigation ---

    ...[
      { id: "editor_cursor_move", iterations: 100, fixture: longInteractionFixture },
      { id: "editor_cursor_move_xlarge", iterations: 50, fixture: xlargeInteractionFixture },
      { id: "editor_cursor_move_huge", iterations: 200, fixture: hugeInteractionFixture },
    ].map(({ fixture, id, iterations }) =>
      createBenchmarkScenario(id, iterations, () => {
        const { layout } = fixture;
        let state = fixture.state;

        for (let step = 0; step < 25; step += 1) {
          const nextState = moveSelectionToNextLine(state, layout);

          if (!nextState) {
            break;
          }

          state = nextState;
        }
      }),
    ),

    // --- Clipboard ---

    // Copy on a long doc: select-all → extractFragment + serializeFragment.
    // Stresses the cross-root trim + serialize walk over every block.
    createBenchmarkScenario("editor_copy_long", 100, () => {
      const fragment = copySelection(longSelectAllState);

      if (fragment) {
        void serializeFragment(fragment);
      }
    }),

    // Paste a multi-block fragment (the medium fixture, ≈100 blocks) into
    // a long doc. Stresses parseFragment, the structural merge at the splice
    // boundary, and the comment finalize after the splice.
    createBenchmarkScenario("editor_paste_blocks_long", 100, () => {
      const fragment = parseFragment(fixtures.mediumMarkdown);
      void pasteFragment(longCaretState, fragment, fixtures.mediumMarkdown);
    }),

    // Paste a single paragraph with many marked runs (≈100 inline nodes
    // interleaving bold / italic / code / link). Stresses spliceInlineNodes
    // and the inline-defragment pass at the splice boundaries.
    createBenchmarkScenario("editor_paste_inlines_dense", 200, () => {
      const fragment = parseFragment(denseInlinesSource);
      void pasteFragment(longCaretState, fragment, denseInlinesSource);
    }),
  ];
}

// --- Benchmark helpers ---

export function createDenseCommentSnapshot(snapshot: Document, count: number) {
  const containers = listAnchorContainers(snapshot);
  const primaryContainer = containers.find((container) => container.text.includes("Bullet item"));

  if (!primaryContainer) {
    return snapshot;
  }

  const comments = Array.from({ length: count }, (_, index) => {
    const startOffset = Math.min(index, Math.max(0, primaryContainer.text.length - 7));
    const endOffset = Math.min(primaryContainer.text.length, startOffset + 6);

    return createCommentThread({
      ...captureTextAnchor(primaryContainer, startOffset, endOffset),
      body: `Dense benchmark ${index + 1}`,
      createdAt: `2026-04-05T12:${String(index).padStart(2, "0")}:00.000Z`,
    });
  });

  return {
    ...snapshot,
    comments,
  };
}

// One thread on every `stride`th container, quoting its "topic N" phrase.
function createSpreadCommentSnapshot(snapshot: Document, stride: number) {
  const comments = listAnchorContainers(snapshot)
    .filter((_, index) => index % stride === 0)
    .map((container, index) => {
      const startOffset = container.text.indexOf("topic");
      const endOffset = container.text.indexOf(" with");

      return createCommentThread({
        ...captureTextAnchor(container, startOffset, endOffset),
        body: `Spread benchmark ${index + 1}`,
        createdAt: "2026-04-05T12:00:00.000Z",
      });
    });

  return {
    ...snapshot,
    comments,
  };
}

// A reopened file whose table repeats "Yes" down a status column, with a
// comment on every `stride`th "Yes" and the caret at the end of a middle "Ye".
function createRepeatedCellCommentState(rows: number, stride: number) {
  const statuses = Array.from({ length: rows }, (_, row) =>
    row === rows / 2 ? "Ye" : row % 3 === 2 ? "No" : "Yes",
  );
  const copies = statuses.filter((status) => status === "Yes").length;
  const comments = Array.from({ length: Math.ceil(copies / stride) }, (_, index) => ({
    anchor: { kind: "tableCell", occurrence: index * stride + 1 },
    comments: [{ body: `Status ${index + 1}`, updatedAt: "2026-04-05T12:00:00.000Z" }],
    quote: "Yes",
  }));
  const markdown = [
    "| Task | Owner | Done |",
    "| --- | --- | --- |",
    ...statuses.map((status, row) => `| Task ${row} | Owner ${row % 7} | ${status} |`),
    "",
    ":::documint-comments",
    JSON.stringify(comments),
    ":::",
    "",
  ].join("\n");

  const state = createEditorState(parseDocument(markdown));
  const cell = indexedTextEntries(state).find((entry) => entry.text === "Ye")!;

  return setSelection(state, { offset: 2, path: cell.path });
}

function selectCanvasText(snapshot: Document, text: string, offset: number) {
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

// Places carets in the middle table cell and in the first section's prose, then
// sweeps a layout cache over the whole document, as a reader scrolling to that
// cell would.
function createTablesEditingFixture(snapshot: Document) {
  const editorState = createEditorState(snapshot);
  const entries = indexedTextEntries(editorState);
  const cells = entries.filter((entry) => entry.tableCell?.rowIndex === 2);
  const cell = cells[Math.floor(cells.length / 2)];
  const prose = entries[1];

  if (!cell || !prose) {
    throw new Error("Expected a table cell and prose");
  }

  const state = setSelection(editorState, { path: cell.path, offset: 0 });
  const cache = createLayoutCache();
  let height = Number.POSITIVE_INFINITY;
  let cellTop = 0;

  for (let top = 0; top < height; top += BENCHMARK_VIEWPORT.height / 2) {
    const layoutState = createEditorLayoutState(state, { ...BENCHMARK_VIEWPORT, top }, cache);
    height = layoutState.layout.height;
    cellTop = layoutState.estimatePathBounds(cell.path)?.top ?? cellTop;
  }

  return {
    cache,
    cellState: state,
    lineBreakState: setSelection(editorState, { path: prose.path, offset: "Section".length }),
    viewport: { ...BENCHMARK_VIEWPORT, top: Math.max(0, cellTop - BENCHMARK_VIEWPORT.height / 2) },
  };
}

function selectMiddleTextPath(snapshot: Document) {
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

function createMiddleRootReplacementAction(state: EditorState) {
  const rootIndex = Math.floor(state.documentIndex.roots.length / 2);

  return {
    blocks: [createParagraphTextBlock(`Replacement root ${rootIndex}`)],
    count: 1,
    kind: "splice-blocks" as const,
    rootIndex,
    selection: null,
  };
}

function createLongInteractionFixture(snapshot: Document) {
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

function moveSelectionToNextLine(state: EditorState, layout: DocumentLayout) {
  const caret = measureCaretTarget(layout, {
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
    x: resolveCaretHitTestX(layout, caret),
    y: targetLine.top + targetLine.height / 2,
  });

  return hit
    ? setSelection(state, {
        path: hit.path,
        offset: hit.offset,
      })
    : null;
}

function findCurrentLine(state: EditorState, layout: DocumentLayout) {
  return findLineForPathOffset(layout, state.selection.focus.path, state.selection.focus.offset);
}

function selectEntireDocument(snapshot: Document) {
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
