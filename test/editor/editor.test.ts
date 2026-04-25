import { expect, test } from "bun:test";
import {
  createCanvasRenderCache,
  createEditorState,
  deleteBackward,
  deleteForward,
  getDocument,
  hasNewAnimation,
  hasRunningAnimations,
  insertLineBreak,
  insertText,
  measureCaretTarget,
  moveCaretToLineBoundary,
  prepareViewport,
  removeLink,
  resolveHoverTarget,
  setSelection,
  updateLink,
} from "@/editor";
import { getEditorAnimationDuration } from "@/editor/canvas/animations";
import { createDocumentLayout } from "@/editor/layout";
import { serializeMarkdown } from "@/markdown";
import { parseMarkdown } from "@/markdown";

test("extends the selection to the current line boundary for modified shift-arrow navigation", () => {
  const state = createEditorState(parseMarkdown("alpha beta gamma"));
  const container = state.documentIndex.regions[0];

  expect(container).toBeDefined();

  const layout = createDocumentLayout(state.documentIndex, { width: 90 });
  const nextState = setSelection(state, {
    anchor: {
      regionId: container!.id,
      offset: container!.text.length,
    },
    focus: {
      regionId: container!.id,
      offset: container!.text.length,
    },
  });
  const result = moveCaretToLineBoundary(nextState, layout, "Home", true);

  expect(result).not.toBeNull();
  expect(result!.selection.anchor.regionId).toBe(container!.id);
  expect(result!.selection.anchor.offset).toBe(container!.text.length);
  expect(result!.selection.focus.regionId).toBe(container!.id);
  expect(result!.selection.focus.offset).toBeGreaterThan(0);
  expect(result!.selection.focus.offset).toBeLessThan(container!.text.length);
});

test("deletes adjacent images atomically", () => {
  const state = createEditorState(
    parseMarkdown("before ![alt](https://example.com/image.png) after\n"),
  );
  const container = state.documentIndex.regions[0];

  if (!container) {
    throw new Error("Expected paragraph container");
  }

  const imageRun = container.inlines.find((run) => run.kind === "image");

  if (!imageRun) {
    throw new Error("Expected image run");
  }

  const backward = deleteBackward(
    setSelection(state, {
      regionId: container.id,
      offset: imageRun.end,
    }),
  );
  const forward = deleteForward(
    setSelection(state, {
      regionId: container.id,
      offset: imageRun.start,
    }),
  );

  expect(backward).not.toBeNull();
  expect(forward).not.toBeNull();
  expect(serializeMarkdown(getDocument(backward!))).toBe("before  after\n");
  expect(serializeMarkdown(getDocument(forward!))).toBe("before  after\n");
});

test("does not persist a typed trailing prose space as a markdown entity", () => {
  const state = createEditorState(parseMarkdown("alpha\n"));
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected paragraph region");
  }

  const stateAtEnd = setSelection(state, {
    regionId: region.id,
    offset: region.text.length,
  });
  const result = insertText(stateAtEnd, " ");

  expect(result).not.toBeNull();
  expect(serializeMarkdown(getDocument(result!))).toBe("alpha\n");
});

test("starts and expires inserted-text highlight animations for typed text", () => {
  const state = createEditorState(parseMarkdown("alpha\n"));
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected paragraph region");
  }

  const stateAtEnd = setSelection(state, {
    regionId: region.id,
    offset: region.text.length,
  });
  const result = insertText(stateAtEnd, "!");

  expect(result).not.toBeNull();
  expect(hasNewAnimation(stateAtEnd, result!)).toBe(true);
  expect(result!.animations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        endOffset: region.text.length + 1,
        kind: "inserted-text-highlight",
        regionPath: region.path,
        startOffset: region.text.length,
      }),
    ]),
  );

  const effect = result!.animations.find(
    (animation) => animation.kind === "inserted-text-highlight",
  );

  expect(effect).toBeDefined();
  expect(hasRunningAnimations(result!, effect!.startedAt + 10)).toBe(true);
  expect(
    hasRunningAnimations(
      result!,
      effect!.startedAt + getEditorAnimationDuration(effect!) + 10,
    ),
  ).toBe(false);
});

test("starts a punctuation pulse animation when typing a period", () => {
  const state = createEditorState(parseMarkdown("alpha\n"));
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected paragraph region");
  }

  const stateAtEnd = setSelection(state, {
    regionId: region.id,
    offset: region.text.length,
  });
  const stateUpdate = insertText(stateAtEnd, ".");

  expect(stateUpdate).not.toBeNull();
  expect(hasNewAnimation(stateAtEnd, stateUpdate!)).toBe(true);
  expect(stateUpdate!.animations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "punctuation-pulse",
        offset: region.text.length,
        regionPath: region.path,
      }),
    ]),
  );

  const pulse = stateUpdate!.animations.find(
    (animation) => animation.kind === "punctuation-pulse",
  );
  const stateWithPunctuationPulseOnly = {
    ...stateUpdate!,
    animations: pulse ? [pulse] : [],
  };

  expect(pulse).toBeDefined();
  expect(hasRunningAnimations(stateWithPunctuationPulseOnly, pulse!.startedAt + 10)).toBe(
    true,
  );
  expect(
    hasRunningAnimations(
      stateWithPunctuationPulseOnly,
      pulse!.startedAt + getEditorAnimationDuration(pulse!) + 10,
    ),
  ).toBe(false);
});

test("does not start a punctuation pulse animation for ordinary text input", () => {
  const state = createEditorState(parseMarkdown("alpha\n"));
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected paragraph region");
  }

  const stateAtEnd = setSelection(state, {
    regionId: region.id,
    offset: region.text.length,
  });
  const stateUpdate = insertText(stateAtEnd, "a");

  expect(stateUpdate).not.toBeNull();
  expect(
    stateUpdate!.animations.some((animation) => animation.kind === "punctuation-pulse"),
  ).toBe(false);
});

test("starts and expires deleted-text fade animations for single-character deletes", () => {
  const state = createEditorState(parseMarkdown("alpha\n"));
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected paragraph region");
  }

  const stateAtEnd = setSelection(state, {
    regionId: region.id,
    offset: region.text.length,
  });
  const stateUpdate = deleteBackward(stateAtEnd);

  expect(stateUpdate).not.toBeNull();
  expect(hasNewAnimation(stateAtEnd, stateUpdate!)).toBe(true);
  expect(stateUpdate!.animations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "deleted-text-fade",
        regionPath: region.path,
        startOffset: region.text.length - 1,
        text: "a",
      }),
    ]),
  );

  const animation = stateUpdate!.animations.find(
    (candidate) => candidate.kind === "deleted-text-fade",
  );
  const stateWithDeletedTextFadeOnly = {
    ...stateUpdate!,
    animations: animation ? [animation] : [],
  };

  expect(animation).toBeDefined();
  expect(hasRunningAnimations(stateWithDeletedTextFadeOnly, animation!.startedAt + 10)).toBe(
    true,
  );
  expect(
    hasRunningAnimations(
      stateWithDeletedTextFadeOnly,
      animation!.startedAt + getEditorAnimationDuration(animation!) + 10,
    ),
  ).toBe(false);
});

test("starts an active-block flash animation when selection moves into a different block", () => {
  const state = createEditorState(parseMarkdown("alpha\n\nbeta\n"));
  const firstRegion = state.documentIndex.regions[0];
  const secondRegion = state.documentIndex.regions[1];

  if (!firstRegion || !secondRegion) {
    throw new Error("Expected two paragraph regions");
  }

  const stateAtFirstBlock = setSelection(state, {
    regionId: firstRegion.id,
    offset: 0,
  });
  const stateUpdate = setSelection(stateAtFirstBlock, {
    regionId: secondRegion.id,
    offset: 0,
  });

  expect(hasNewAnimation(stateAtFirstBlock, stateUpdate)).toBe(true);
  expect(stateUpdate.animations).toEqual([
    expect.objectContaining({
      blockPath: "root.1",
      kind: "active-block-flash",
    }),
  ]);
});

test("starts an active-block flash animation when selection moves into a different table cell", () => {
  const state = createEditorState(parseMarkdown("| A | B |\n| - | - |\n| one | two |\n"));
  const firstCell = state.documentIndex.regions[0];
  const secondCell = state.documentIndex.regions[1];

  if (!firstCell || !secondCell) {
    throw new Error("Expected table cell regions");
  }

  expect(firstCell.blockId).toBe(secondCell.blockId);
  expect(firstCell.path).not.toBe(secondCell.path);

  const stateAtFirstCell = setSelection(state, {
    regionId: firstCell.id,
    offset: 0,
  });
  const stateUpdate = setSelection(stateAtFirstCell, {
    regionId: secondCell.id,
    offset: 0,
  });

  expect(hasNewAnimation(stateAtFirstCell, stateUpdate)).toBe(true);
  expect(stateUpdate.animations).toEqual([
    expect.objectContaining({
      blockPath: "root.0",
      kind: "active-block-flash",
    }),
  ]);
});

test("starts a list-marker-pop animation when splitting a list item with insertLineBreak", () => {
  const state = createEditorState(parseMarkdown("- alpha\n"));
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected list item region");
  }

  const stateAtEnd = setSelection(state, {
    regionId: region.id,
    offset: region.text.length,
  });
  const stateUpdate = insertLineBreak(stateAtEnd);

  expect(stateUpdate).not.toBeNull();
  expect(hasNewAnimation(stateAtEnd, stateUpdate!)).toBe(true);
  expect(stateUpdate!.animations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "list-marker-pop",
      }),
    ]),
  );
});

test("does not re-trigger list-marker-pop animation when typing inside an existing list item", () => {
  const state = createEditorState(parseMarkdown("- alpha\n"));
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected list item region");
  }

  const stateAtEnd = setSelection(state, {
    regionId: region.id,
    offset: region.text.length,
  });
  const stateUpdate = insertText(stateAtEnd, "b");

  expect(stateUpdate).not.toBeNull();
  expect(
    stateUpdate!.animations.some((animation) => animation.kind === "list-marker-pop"),
  ).toBe(false);
});

test("does not start a list-marker-pop animation when splitting a task list item", () => {
  const state = createEditorState(parseMarkdown("- [ ] task\n"));
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected task list item region");
  }

  const stateAtEnd = setSelection(state, {
    regionId: region.id,
    offset: region.text.length,
  });
  const stateUpdate = insertLineBreak(stateAtEnd);

  expect(stateUpdate).not.toBeNull();
  expect(
    stateUpdate!.animations.some((animation) => animation.kind === "list-marker-pop"),
  ).toBe(false);
});

test("resolves task-toggle hover targets ahead of text hits", () => {
  const renderCache = createCanvasRenderCache();
  const state = createEditorState(parseMarkdown("- [ ] Review task\n"));
  const viewport = prepareViewport(state, {
    height: 320,
    top: 0,
    width: 520,
  }, renderCache);
  const line = viewport.layout.lines[0];
  const listItem = state.documentIndex.blocks.find((block) => block.type === "listItem");

  if (!line || !listItem) {
    throw new Error("Expected task list line");
  }

  const hover = resolveHoverTarget(
    state,
    viewport,
    {
      x: line.left + 6,
      y: line.top + line.height / 2,
    },
    [],
  );

  expect(hover).toEqual({
    kind: "task-toggle",
    listItemId: listItem.id,
  });
});

test("updates hovered link urls semantically", () => {
  const state = createEditorState(parseMarkdown("Paragraph with [link](https://example.com).\n"));
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected region");
  }

  const linkRun = region.inlines.find((run) => run.link);

  if (!linkRun?.link) {
    throw new Error("Expected link run");
  }

  const result = updateLink(
    state,
    region.id,
    linkRun.start,
    linkRun.end,
    "https://openai.com",
  );

  expect(result).not.toBeNull();
  expect(serializeMarkdown(getDocument(result!))).toBe(
    "Paragraph with [link](https://openai.com).\n",
  );
});

test("removes hovered links while preserving linked text", () => {
  const state = createEditorState(parseMarkdown("Paragraph with [link](https://example.com).\n"));
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected region");
  }

  const linkRun = region.inlines.find((run) => run.link);

  if (!linkRun?.link) {
    throw new Error("Expected link run");
  }

  const result = removeLink(state, region.id, linkRun.start, linkRun.end);

  expect(result).not.toBeNull();
  expect(serializeMarkdown(getDocument(result!))).toBe("Paragraph with link.\n");
});
