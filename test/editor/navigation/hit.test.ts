import { indexedTextEntries } from "@test/editor/helpers";
import { expect, test } from "bun:test";
import {
  createLayoutCache,
  createEditorLayoutState,
  extendSelectionToPoint,
  getCommentState,
  resolveHoverTarget,
  setSelection,
  type DocumentResources,
} from "@/editor";
import { addComment, createEditorState, metadataValuePath } from "@/editor/state";
import { measureCaretTarget } from "@/editor/layout";
import {
  resolveEditorHitAtPoint,
  resolveSelectionPointAt,
  resolveWordSelection,
} from "@/editor/navigation";
import { resolveDragFocus } from "@/editor/navigation/hit";
import { measureLayoutSlice } from "@/editor/layout/measure";
import { parseDocument } from "@/markdown";
import { getPath, getPathByType, setup } from "../helpers";

test("hit-tests canvas layout coordinates back to semantic offsets", () => {
  const state = setup(`Paragraph with semantic offsets.\n`);
  const layout = measureLayoutSlice(state.documentIndex, {
    width: 320,
  });
  const paragraphContainer = indexedTextEntries(state)[0];

  if (!paragraphContainer) {
    throw new Error("Expected paragraph container");
  }

  const hit = resolveEditorHitAtPoint(layout, state, {
    x: measureCaretTarget(layout, {
      path: paragraphContainer.path,
      offset: 10,
    })!.left,
    y: layout.lines[0]!.top + 2,
  });

  expect(hit?.path).toBe(paragraphContainer.path);
  expect(hit?.offset).toBe(10);
});

test("hit-tests the second line of a multi-line wrapped paragraph", () => {
  const state = setup(
    `This is a long paragraph that will wrap to multiple lines when laid out at a narrow width for testing.\n`,
  );
  const layout = measureLayoutSlice(state.documentIndex, {
    width: 200,
  });
  const container = indexedTextEntries(state)[0];

  if (!container) {
    throw new Error("Expected paragraph container");
  }

  const pathLines = layout.lines.filter((line) => line.path === container.path);

  expect(pathLines.length).toBeGreaterThan(1);

  const secondLine = pathLines[1]!;

  // Use resolveEditorHitAtPoint — the same two-phase path the click handler
  // takes — to verify that clicking in the middle of line 2 resolves to an
  // offset within line 2, not line 1.
  const hit = resolveEditorHitAtPoint(layout, state, {
    x: secondLine.left + 20,
    y: secondLine.top + secondLine.height / 2,
  });

  expect(hit?.path).toBe(container.path);
  expect(hit?.offset).toBeGreaterThanOrEqual(secondLine.start);
  expect(hit?.offset).toBeLessThanOrEqual(secondLine.end);
});

test("keeps clicks left of a soft-wrapped line start on that visual line", () => {
  const text =
    "Dialect changes update recognition and emission together. Block readers, inline token readers, inline mark specs, block-start escape predicates, serializer output, preservation policy, and SUPPORT.md status move together so parser and serializer behavior does not drift.";
  const state = setup(`- ${text}\n`);
  const path = getPath(state, text);
  const layout = measureLayoutSlice(state.documentIndex, { width: 740 });
  const pathLines = layout.lines.filter((line) => line.path === path.path);
  const wrappedStarts = pathLines.slice(1, 3);

  expect(wrappedStarts).toHaveLength(2);
  expect(pathLines[0]!.end).toBe(wrappedStarts[0]!.start);
  expect(wrappedStarts[0]!.end).toBe(wrappedStarts[1]!.start);

  for (const line of wrappedStarts) {
    const hit = resolveEditorHitAtPoint(layout, state, {
      x: line.left + line.contentInset - 3,
      y: line.top + line.height / 2,
    });

    expect(hit?.path).toBe(path.path);
    expect(hit?.offset).toBe(line.start);

    const caret = hit
      ? measureCaretTarget(layout, {
          offset: hit.offset,
          path: hit.path,
        })
      : null;

    expect(caret?.top).toBe(line.top);
  }
});

test("resolves link hits from document-space coordinates over linked text", () => {
  const state = setup("[alpha](https://example.com) tail\n");
  const layout = measureLayoutSlice(state.documentIndex, {
    width: 320,
  });
  const line = layout.lines[0];

  if (!line) {
    throw new Error("Expected first layout line");
  }

  expect(
    resolveHoverTarget(state, { layout }, { x: line.left + 4, y: line.top + 4 }, []),
  ).toMatchObject({ kind: "link", url: "https://example.com" });
});

test("limits link hover targets to the visual line bounds", () => {
  const state = setup("[alpha](https://example.com) tail\n");
  const layout = measureLayoutSlice(state.documentIndex, {
    width: 320,
  });
  const line = layout.lines[0];

  if (!line) {
    throw new Error("Expected first layout line");
  }

  const x = line.left + 4;

  expect(
    resolveHoverTarget(state, { layout }, { x, y: line.top + line.height - 0.01 }, []),
  ).toMatchObject({ kind: "link" });
  expect(resolveHoverTarget(state, { layout }, { x, y: line.top + line.height }, [])).toBeNull();
});

test("limits comment hover targets to quoted text at a line end", () => {
  let state = setup("Prefix quoted\n");
  const path = getPath(state, "Prefix quoted");
  state =
    addComment(
      state,
      {
        endOffset: path.text.length,
        path: path.path,
        startOffset: "Prefix ".length,
      },
      "Review quote",
    ) ?? state;
  const layout = measureLayoutSlice(state.documentIndex, { width: 320 });
  const line = layout.lines[0];
  const quoteEnd = measureCaretTarget(layout, {
    path: path.path,
    offset: path.text.length,
  });

  if (!line || !quoteEnd) {
    throw new Error("Expected quoted text geometry");
  }

  const commentRanges = getCommentState(state.documentIndex).ranges;
  const y = line.top + line.height / 2;

  expect(
    resolveHoverTarget(state, { layout }, { x: quoteEnd.left - 1, y }, commentRanges),
  ).toMatchObject({ commentThreadIndex: 0, kind: "text" });
  expect(
    resolveHoverTarget(state, { layout }, { x: quoteEnd.left + 40, y }, commentRanges),
  ).toEqual({ commentThreadIndex: null, kind: "text" });
});

test("resolves drag focus to the anchor start above the prepared layout", () => {
  const state = setup("alpha beta\n");
  const layout = measureLayoutSlice(state.documentIndex, {
    width: 320,
  });
  const path = indexedTextEntries(state)[0];
  const firstLine = layout.lines[0];

  if (!path || !firstLine) {
    throw new Error("Expected first path and first layout line");
  }

  expect(
    resolveDragFocus(
      state,
      { layout },
      {
        x: firstLine.left,
        y: firstLine.top - 40,
      },
      {
        path: path.path,
        offset: 4,
      },
    ),
  ).toEqual({
    offset: 0,
    path: path.path,
  });
});

test("resolves drag focus into a different path instead of clamping to the anchor", () => {
  const state = setup("alpha\n\nbeta\n");
  const layout = measureLayoutSlice(state.documentIndex, {
    width: 320,
  });
  const [firstPath, secondPath] = indexedTextEntries(state);

  if (!firstPath || !secondPath) {
    throw new Error("Expected two paragraph paths");
  }

  const secondLine = layout.lines.find((line) => line.path === secondPath.path);

  if (!secondLine) {
    throw new Error("Expected a layout line for the second path");
  }

  expect(
    resolveDragFocus(
      state,
      { layout },
      {
        x: secondLine.left + 4,
        y: secondLine.top + secondLine.height / 2,
      },
      {
        path: firstPath.path,
        offset: 2,
      },
    ),
  ).toEqual({
    offset: expect.any(Number),
    path: secondPath.path,
  });
});

test("resolves drag focus to the anchor end below the prepared layout", () => {
  const state = setup("alpha beta\n");
  const layout = measureLayoutSlice(state.documentIndex, {
    width: 320,
  });
  const path = indexedTextEntries(state)[0];
  const lastLine = layout.lines.at(-1);

  if (!path || !lastLine) {
    throw new Error("Expected first path and last layout line");
  }

  expect(
    resolveDragFocus(
      state,
      { layout },
      {
        x: lastLine.left,
        y: lastLine.top + lastLine.height + 40,
      },
      {
        path: path.path,
        offset: 4,
      },
    ),
  ).toEqual({
    offset: path.text.length,
    path: path.path,
  });
});

test("resolves a click on the trailing empty line below a soft break to its post-break offset", () => {
  // After Shift+Enter at end-of-content, the layout materializes an empty
  // trailing line at `[lastSegment.end, lastSegment.end]` so the caret has
  // somewhere to land. This locks down that clicking on that visible empty
  // line resolves to the offset just past the soft break — anything else
  // would leave the caret unable to follow the user's click.
  const state = setup("foo<br>\n");
  const path = getPath(state, "foo\n");
  const layout = measureLayoutSlice(state.documentIndex, { width: 320 });

  const trailingLine = layout.lines.find((line) => line.path === path.path && line.text === "");

  if (!trailingLine) {
    throw new Error("Expected a trailing empty line for the soft break");
  }

  const hit = resolveEditorHitAtPoint(layout, state, {
    x: trailingLine.left + 4,
    y: trailingLine.top + trailingLine.height / 2,
  });

  expect(hit?.path).toBe(path.path);
  expect(hit?.offset).toBe(path.text.length);
});

test("resolves clicks inside code block lines to source offsets", () => {
  const state = setup("```ts\nconst value = 1;\n```\n");
  const path = getPathByType(state, "code");
  const layout = measureLayoutSlice(state.documentIndex, { width: 320 });
  const caret = measureCaretTarget(layout, {
    path: path.path,
    offset: "const".length,
  });

  if (!caret) {
    throw new Error("Expected code caret");
  }

  const hit = resolveEditorHitAtPoint(layout, state, {
    x: caret.left,
    y: caret.top + caret.height / 2,
  });

  expect(hit?.path).toBe(path.path);
  expect(hit?.offset).toBe("const".length);
});

test("resolves word selection with shared unicode word boundaries", () => {
  const state = setup("hello 世界\n");
  const path = getPath(state, "hello 世界");
  const layout = measureLayoutSlice(state.documentIndex, { width: 320 });
  const caret = measureCaretTarget(layout, {
    path: path.path,
    offset: 7,
  });

  if (!caret) {
    throw new Error("Expected caret target inside unicode word");
  }

  expect(
    resolveWordSelection(
      state,
      { layout },
      {
        x: caret.left,
        y: caret.top + caret.height / 2,
      },
    ),
  ).toEqual({
    anchor: {
      offset: 6,
      path: path.path,
    },
    focus: {
      offset: 8,
      path: path.path,
    },
  });
});

test("hit-tests the correct table column within the same row band", () => {
  const state = setup(`| Layer | Narrow host | Wide host |
| :---- | :---------- | --------: |
| Editor | stable | 640 |
`);
  const layout = measureLayoutSlice(state.documentIndex, {
    width: 640,
  });
  const headerValue = layout.lines.find((line) => line.text === "Wide host");

  if (!headerValue) {
    throw new Error("Expected wide-host header line");
  }

  const extent = layout.pathBounds.get(headerValue.path);

  if (!extent) {
    throw new Error("Expected table cell bounds");
  }

  const hit = resolveEditorHitAtPoint(layout, state, {
    x: extent.left + 8,
    y: headerValue.top + 4,
  });

  expect(hit?.path).toBe(headerValue.path);
});

test("hit-tests the clicked table cell even below its text content", () => {
  const state = setup(`| Short | Much wider content that wraps |
| :---- | :---------------------------- |
| One | Two three four five six seven eight nine ten eleven twelve |
`);
  const layout = measureLayoutSlice(state.documentIndex, {
    width: 220,
  });
  const shortCellLine = layout.lines.find((line) => line.text === "One");

  if (!shortCellLine) {
    throw new Error("Expected short cell line");
  }

  const extent = layout.pathBounds.get(shortCellLine.path);

  if (!extent) {
    throw new Error("Expected short cell bounds");
  }

  const neighboringLineY = layout.lines.find(
    (line) =>
      line.path !== shortCellLine.path &&
      line.top > shortCellLine.top + shortCellLine.height &&
      line.top < extent.bottom,
  )?.top;

  if (neighboringLineY === undefined) {
    throw new Error("Expected wrapped neighboring cell line inside the short cell bounds");
  }

  const hit = resolveEditorHitAtPoint(layout, state, {
    x: extent.left + 8,
    y: neighboringLineY + 2,
  });

  expect(hit?.path).toBe(shortCellLine.path);
  expect(hit?.offset).toBe(0);
});

test("hit-tests image runs as single reference caret stops", () => {
  const state = setup("before ![alt](https://example.com/image.png) after\n");
  const resources: DocumentResources = {
    images: new Map([
      [
        "https://example.com/image.png",
        {
          intrinsicHeight: 120,
          intrinsicWidth: 160,
          source: null,
          status: "loaded",
        },
      ],
    ]),
    resourceRegistry: { active: new Set(), protocols: new Map() },
  };
  const layout = measureLayoutSlice(state.documentIndex, { width: 520 }, undefined, resources);
  const line = layout.lines[0];
  const paragraph = indexedTextEntries(state)[0];

  if (!line || !paragraph) {
    throw new Error("Expected image paragraph layout");
  }

  const imageRun = (paragraph.inlines ?? []).find((run) => run.node.type === "image");

  if (!imageRun) {
    throw new Error("Expected image run");
  }

  const beforeImage = measureCaretTarget(layout, {
    path: paragraph.path,
    offset: imageRun.start,
  });
  const afterImage = measureCaretTarget(layout, {
    path: paragraph.path,
    offset: imageRun.end,
  });

  if (!beforeImage || !afterImage) {
    throw new Error("Expected image caret targets");
  }

  const leftHit = resolveEditorHitAtPoint(layout, state, {
    x: beforeImage.left + (afterImage.left - beforeImage.left) * 0.25,
    y: line.top + line.height / 2,
  });
  const rightHit = resolveEditorHitAtPoint(layout, state, {
    x: beforeImage.left + (afterImage.left - beforeImage.left) * 0.75,
    y: line.top + line.height / 2,
  });

  expect(leftHit?.offset).toBe(imageRun.start);
  expect(rightHit?.offset).toBe(imageRun.end);
});

test("resolves resource hover targets from registered resource inlines", () => {
  const state = createEditorState(
    parseDocument("[Recording](demo-resource://recording/live)\n", {
      resourceProtocols: ["demo-resource:"],
    }),
  );
  const resources: DocumentResources = {
    images: new Map(),
    resourceRegistry: {
      active: new Set(["demo-resource://recording/live"]),
      protocols: new Map([["demo-resource:", { icon: "R", label: "Demo resource" }]]),
    },
  };
  const viewport = createEditorLayoutState(
    state,
    { height: 320, top: 0, width: 520 },
    undefined,
    resources,
  );
  const line = viewport.layout.lines[0];
  const paragraph = indexedTextEntries(state)[0];

  if (!line || !paragraph) {
    throw new Error("Expected resource paragraph layout");
  }

  const inlines = paragraph.inlines ?? [];
  expect(inlines).toHaveLength(1);
  expect(inlines[0]?.node.type).toBe("resource");
  expect(inlines[0]?.link).toBeNull();

  const hover = resolveHoverTarget(
    state,
    viewport,
    {
      x: line.left + line.width / 2,
      y: line.top + line.height / 2,
    },
    [],
  );

  expect(hover).toMatchObject({
    label: "Recording",
    kind: "resource",
    protocol: "demo-resource:",
    url: "demo-resource://recording/live",
  });

  const leftEdgeHover = resolveHoverTarget(
    state,
    viewport,
    {
      x: line.left + 1,
      y: line.top + line.height / 2,
    },
    [],
  );

  expect(leftEdgeHover).toMatchObject({
    kind: "resource",
    url: "demo-resource://recording/live",
  });

  const rightEdgeHover = resolveHoverTarget(
    state,
    viewport,
    {
      x: line.left + line.width - 1,
      y: line.top + line.height / 2,
    },
    [],
  );

  expect(rightEdgeHover).toMatchObject({
    kind: "resource",
    url: "demo-resource://recording/live",
  });
});

test("keeps ordinary registered-protocol links as link hover targets without resource parsing", () => {
  const state = createEditorState(parseDocument("[Recording](demo-resource://recording/live)\n"));
  const viewport = createEditorLayoutState(state, { height: 320, top: 0, width: 520 });
  const line = viewport.layout.lines[0];

  if (!line) throw new Error("Expected link paragraph layout");

  const hover = resolveHoverTarget(
    state,
    viewport,
    {
      x: line.left + line.width / 2,
      y: line.top + line.height / 2,
    },
    [],
  );

  expect(hover).toMatchObject({
    kind: "link",
    url: "demo-resource://recording/live",
  });
});

test("resolves task-toggle hover targets ahead of text hits", () => {
  const layoutCache = createLayoutCache();
  const state = setup("- [ ] Review task\n");
  const viewport = createEditorLayoutState(state, { height: 320, top: 0, width: 520 }, layoutCache);
  const line = viewport.layout.lines[0];
  const listItem = state.documentIndex.blocks.find((entry) => entry.block.type === "listItem");

  if (!line || !listItem) throw new Error("Expected task list line");

  const hover = resolveHoverTarget(
    state,
    viewport,
    {
      x: line.left + 6,
      y: line.top + line.height / 2,
    },
    [],
  );

  expect(hover).toEqual({ kind: "task-toggle", listItemPath: listItem.path });
});

const metadataHitFixture = `---
title: Draft
draft: true
slug: sample
---
Body
`;

test("resolves metadata header, checkbox, and text hit precedence", () => {
  const state = setup(metadataHitFixture);
  const layout = measureLayoutSlice(state.documentIndex, {
    metadataExpanded: true,
    width: 520,
  });
  const metadata = layout.metadata;
  const checkbox = metadata?.rows[1]?.checkbox;

  if (!metadata || !checkbox) {
    throw new Error("Expected metadata interaction geometry");
  }

  const header = metadata.header;
  const centerY = header.top + header.height / 2;
  const headerPoint = {
    x: header.left + header.width - 1,
    y: centerY,
  };

  expect(resolveHoverTarget(state, { layout }, headerPoint, [])).toEqual({
    kind: "metadata-toggle",
  });
  expect(resolveSelectionPointAt(state, { layout }, headerPoint)).toBeNull();
  expect(
    resolveHoverTarget(
      state,
      { layout },
      {
        x: header.left + header.width + 1,
        y: centerY,
      },
      [],
    ),
  ).toBeNull();
  const checkboxPoint = {
    x: checkbox.rect.left - 3,
    y: checkbox.rect.top + checkbox.rect.height / 2,
  };

  expect(resolveHoverTarget(state, { layout }, checkboxPoint, [])).toEqual({
    kind: "metadata-boolean-toggle",
    path: metadataValuePath(1),
  });
  expect(resolveSelectionPointAt(state, { layout }, checkboxPoint)).toBeNull();

  const path = metadataValuePath(0);
  const caret = measureCaretTarget(layout, {
    path,
    offset: 3,
  });

  if (!caret) {
    throw new Error("Expected metadata text caret");
  }

  expect(
    resolveSelectionPointAt(
      state,
      { layout },
      {
        x: caret.left,
        y: caret.top + caret.height / 2,
      },
    ),
  ).toEqual({
    offset: 3,
    path,
  });
});

test("keeps metadata selection extension within one text field", () => {
  let state = setup(metadataHitFixture);
  state = setSelection(state, {
    path: metadataValuePath(0),
    offset: 1,
  });
  const viewport = createEditorLayoutState(state, {
    height: 320,
    metadataExpanded: true,
    top: 0,
    width: 520,
  });
  const slugCaret = measureCaretTarget(viewport.layout, {
    path: metadataValuePath(2),
    offset: 2,
  });
  const bodyLine = viewport.layout.lines.find((line) => line.text === "Body");

  if (!slugCaret || !bodyLine) {
    throw new Error("Expected metadata and body geometry");
  }

  for (const target of [slugCaret, bodyLine]) {
    expect(
      extendSelectionToPoint(state, viewport, {
        x: target.left,
        y: target.top + target.height / 2,
      }),
    ).toBeNull();
  }
});

test("clicks on an inert leaf block redirect to the start of the next path in flow", () => {
  // The divider is an inert leaf — it has no path, so it can't be a
  // caret target itself. A click anywhere in its geometry slot should
  // land the caret at the beginning of the next path rather than
  // returning null (which would feel like a dead area). Goes through
  // `resolveEditorHitAtPoint` — the editor-level path that the user-
  // facing pointer handler uses (`usePointer` → `resolveSelectionPointAt`
  // → `resolveSelectionPointAt` → `resolveEditorHitAtPoint`).
  const state = setup("First paragraph.\n\n---\n\nSecond paragraph.\n");
  const layout = measureLayoutSlice(state.documentIndex, { width: 480 });
  const dividerBlock = layout.blocks.find((b) => b.type === "divider");
  const second = getPath(state, "Second paragraph.");

  if (!dividerBlock) throw new Error("Expected divider block in layout");

  const dividerCenterY = (dividerBlock.top + dividerBlock.bottom) / 2;
  const hit = resolveEditorHitAtPoint(layout, state, { x: 200, y: dividerCenterY });

  expect(hit?.path).toBe(second.path);
  expect(hit?.offset).toBe(0);
});
