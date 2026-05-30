import { describe, expect, test } from "bun:test";
import {
  applyDocumintPatch,
  resolveDocumintPatch,
  type DocumintPatchChange,
} from "@/sync/content-patch";
import { createEditorStateTransition } from "@/component/store/editor/transitions";
import {
  addComment,
  createEditorState,
  deleteBackward,
  insertLineBreak,
  insertText,
} from "@/editor/state";
import { parseDocument } from "@/markdown";
import { getRegion, placeAt, selectIn, setup, toMarkdown } from "@test/editor/helpers";

describe("resolveDocumintPatch", () => {
  describe("line replacements", () => {
    test("emits a line replacement for a single-root text edit", () => {
      expectPatchFromEdit({
        edit: (state) => insertAtRegionText(state, "Beta paragraph", 4, " edited"),
        expectedChanges: [
          {
            startLine: 2,
            endLine: 3,
            text: "Beta edited paragraph",
          },
        ],
        markdown: "Alpha paragraph\n\nBeta paragraph\n",
        revision: "rev-1",
      });
    });

    test("emits a line replacement for deleted text", () => {
      expectPatchFromEdit({
        edit: (state) => replaceInRegionText(state, "Alpha paragraph", 6, 16, ""),
        expectedChanges: [
          {
            startLine: 0,
            endLine: 1,
            text: "Alpha",
          },
        ],
        markdown: "Alpha paragraph\n",
        revision: "rev-1",
      });
    });

    test("accounts for front matter before changed document lines", () => {
      expectPatchFromEdit({
        edit: (state) => insertAtRegionText(state, "Beta paragraph", "end", " edited"),
        expectedChanges: [
          {
            startLine: 6,
            endLine: 7,
            text: "Beta paragraph edited",
          },
        ],
        markdown: "---\ntitle: Test\n---\n\nAlpha paragraph\n\nBeta paragraph\n",
        revision: "rev-2",
      });
    });

    test("emits ordered changes for multiple edited roots", () => {
      expectPatchFromEdit({
        edit: (state) => {
          const first = insertAtRegionText(state, "Alpha paragraph", "end", " edited");
          return first ? insertAtRegionText(first, "Gamma paragraph", "end", " edited") : null;
        },
        expectedChanges: [
          {
            startLine: 0,
            endLine: 1,
            text: "Alpha paragraph edited",
          },
          {
            startLine: 4,
            endLine: 5,
            text: "Gamma paragraph edited",
          },
        ],
        markdown: "Alpha paragraph\n\nBeta paragraph\n\nGamma paragraph\n",
        revision: "rev-multi",
      });
    });
  });

  describe("structured roots", () => {
    test("emits the minimal changed line range inside a multiline root", () => {
      expectPatchFromEdit({
        edit: (state) => insertAtRegionText(state, "first\nsecond\nthird", "end", " edited"),
        expectedChanges: [
          {
            startLine: 2,
            endLine: 3,
            text: "> third edited",
          },
        ],
        markdown: "> first\n> second\n> third\n",
        revision: null,
      });
    });

    test("emits a table row replacement for table cell edits", () => {
      expectPatchFromEdit({
        edit: (state) => insertAtRegionText(state, "one", "end", " edited"),
        expectedChanges: [
          {
            startLine: 2,
            endLine: 3,
            text: "| one edited | two |",
          },
        ],
        markdown: "| A | B |\n| - | - |\n| one | two |\n",
        revision: "rev-table",
      });
    });

    test("emits line insertions inside code roots", () => {
      expectPatchFromEdit({
        edit: (state) =>
          insertAtRegionText(state, "const a = 1;\nconst b = 2;", "end", "\nconst c = 3;"),
        expectedChanges: [
          {
            startLine: 3,
            endLine: 3,
            text: "const c = 3;",
          },
        ],
        markdown: "```ts\nconst a = 1;\nconst b = 2;\n```\n",
        revision: "rev-code",
      });
    });

    test("emits replacements in the middle of code roots", () => {
      expectPatchFromEdit({
        edit: (state) =>
          replaceInRegionText(
            state,
            "const a = 1;\nconst b = 2;\nconst c = 3;",
            "const a = 1;\n".length,
            "const a = 1;\nconst b = 2;".length,
            "const b = 20;",
          ),
        expectedChanges: [
          {
            startLine: 2,
            endLine: 3,
            text: "const b = 20;",
          },
        ],
        markdown: "```ts\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```\n",
        revision: "rev-code",
      });
    });

    test("emits deletions inside code roots", () => {
      expectPatchFromEdit({
        edit: (state) =>
          replaceInRegionText(
            state,
            "const a = 1;\nconst b = 2;\nconst c = 3;",
            "const a = 1;\n".length,
            "const a = 1;\nconst b = 2;\n".length,
            "",
          ),
        expectedChanges: [
          {
            startLine: 2,
            endLine: 3,
            text: "",
          },
        ],
        markdown: "```ts\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```\n",
        revision: "rev-code",
      });
    });

    test("emits replacements inside raw roots", () => {
      expectPatchFromEdit({
        edit: (state) => insertAtRegionText(state, "alpha\nbeta", "end", "\ngamma"),
        expectedChanges: [
          {
            startLine: 4,
            endLine: 4,
            text: "gamma",
          },
        ],
        markdown: "<div>\nalpha\nbeta\n</div>\n",
        revision: "rev-raw",
      });
    });
  });

  describe("generic fallbacks", () => {
    test("uses the generic table fallback when the header row changes", () => {
      expectPatchFromEdit({
        edit: (state) => insertAtRegionText(state, "A", "end", " edited"),
        expectedChanges: [
          {
            startLine: 0,
            endLine: 2,
            text: "| A edited | B |\n| -------- | --- |",
          },
        ],
        markdown: "| A | B |\n| - | - |\n| one | two |\n",
        revision: "rev-table",
      });
    });
  });

  describe("structural root replacements", () => {
    test("emits a root span replacement for paragraph splits", () => {
      expectPatchFromEdit({
        edit: (state) => insertLineBreak(placeAt(state, getRegion(state, "Alpha Beta"), 6)),
        expectedChanges: [
          {
            startLine: 0,
            endLine: 1,
            text: "Alpha\n\nBeta",
          },
        ],
        markdown: "Alpha Beta\n",
        revision: "rev-split",
      });
    });

    test("emits a root span replacement for paragraph merges", () => {
      expectPatchFromEdit({
        edit: (state) => deleteBackward(placeAt(state, getRegion(state, "Beta"), "start")),
        expectedChanges: [
          {
            startLine: 0,
            endLine: 3,
            text: "AlphaBeta",
          },
        ],
        markdown: "Alpha\n\nBeta\n",
        revision: "rev-merge",
      });
    });

    test("emits a root span replacement for list item splits", () => {
      expectPatchFromEdit({
        edit: (state) => insertLineBreak(placeAt(state, getRegion(state, "Alpha Beta"), 6)),
        expectedChanges: [
          {
            startLine: 0,
            endLine: 1,
            text: "- Alpha\n- Beta",
          },
        ],
        markdown: "- Alpha Beta\n",
        revision: "rev-list-split",
      });
    });

    test("emits a root span replacement for list item merges", () => {
      expectPatchFromEdit({
        edit: (state) => deleteBackward(placeAt(state, getRegion(state, "Beta"), "start")),
        expectedChanges: [
          {
            startLine: 0,
            endLine: 2,
            text: "- AlphaBeta",
          },
        ],
        markdown: "- Alpha\n- Beta\n",
        revision: "rev-list-merge",
      });
    });

    test("emits a root span insertion for inserted roots", () => {
      const previous = createEditorState(parseDocument("Alpha paragraph\n"));
      const next = createEditorState(parseDocument("Alpha paragraph\n\nBeta paragraph\n"));
      const patch = resolveDocumintPatch(createTransition(previous, next), "rev-insert-root");

      expect(patch).toEqual({
        changes: [
          {
            startLine: 1,
            endLine: 1,
            text: "\nBeta paragraph",
          },
        ],
        revision: "rev-insert-root",
      });
      expectPatchApplies(previous, next, patch);
    });

    test("emits a root span deletion for deleted roots", () => {
      const previous = createEditorState(
        parseDocument("Alpha paragraph\n\nBeta paragraph\n\nGamma paragraph\n"),
      );
      const next = createEditorState(parseDocument("Alpha paragraph\n\nGamma paragraph\n"));
      const patch = resolveDocumintPatch(createTransition(previous, next), "rev-delete-root");

      expect(patch).toEqual({
        changes: [
          {
            startLine: 2,
            endLine: 4,
            text: "",
          },
        ],
        revision: "rev-delete-root",
      });
      expectPatchApplies(previous, next, patch);
    });

    test("emits a list item span deletion for deleted list items", () => {
      const previous = createEditorState(parseDocument("- Alpha\n- Beta\n- Gamma\n"));
      const next = createEditorState(parseDocument("- Alpha\n- Gamma\n"));
      const patch = resolveDocumintPatch(createTransition(previous, next), "rev-delete-list-item");

      expect(patch).toEqual({
        changes: [
          {
            startLine: 1,
            endLine: 2,
            text: "",
          },
        ],
        revision: "rev-delete-list-item",
      });
      expectPatchApplies(previous, next, patch);
    });
  });

  describe("comment appendix replacements", () => {
    test("emits a comment appendix insertion when adding a thread", () => {
      const previous = setup("Alpha paragraph\n");
      const region = getRegion(previous, "Alpha paragraph");
      const next = addComment(
        previous,
        { endOffset: 5, regionId: region.id, startOffset: 0 },
        "Review this",
      );

      expect(next).not.toBeNull();
      const patch = resolveDocumintPatch(createTransition(previous, next!), "rev-comments");

      expect(patch?.changes).toHaveLength(1);
      expect(patch?.changes[0]?.startLine).toBe(1);
      expect(patch?.changes[0]?.endLine).toBe(1);
      expect(patch?.changes[0]?.text).toContain(":::documint-comments");
      expect(patch?.changes[0]?.text).toContain("Review this");
      expectPatchApplies(previous, next!, patch);
    });

    test("emits a comment appendix deletion when removing the last thread", () => {
      const previous = createEditorState(
        parseDocument(`Alpha paragraph.

:::documint-comments
[
  {
    "anchor": {
      "suffix": " paragraph."
    },
    "comments": [
      {
        "body": "Review this.",
        "updatedAt": "2026-05-29T12:00:00.000Z"
      }
    ],
    "quote": "Alpha"
  }
]
:::
`),
      );
      const next = createEditorState(parseDocument("Alpha paragraph.\n"));
      const patch = resolveDocumintPatch(createTransition(previous, next), "rev-comments");

      expect(patch).toEqual({
        changes: [
          {
            startLine: 1,
            endLine: 18,
            text: "",
          },
        ],
        revision: "rev-comments",
      });
      expectPatchApplies(previous, next, patch);
    });

    test("emits a comment appendix replacement when editing metadata", () => {
      const previous = createEditorState(
        parseDocument(`Alpha paragraph.

:::documint-comments
[
  {
    "anchor": {
      "suffix": " paragraph."
    },
    "comments": [
      {
        "body": "Review this.",
        "updatedAt": "2026-05-29T12:00:00.000Z"
      }
    ],
    "quote": "Alpha"
  }
]
:::
`),
      );
      const next = createEditorState(
        parseDocument(`Alpha paragraph.

:::documint-comments
[
  {
    "anchor": {
      "suffix": " paragraph."
    },
    "comments": [
      {
        "body": "Resolved.",
        "updatedAt": "2026-05-29T12:00:00.000Z"
      }
    ],
    "quote": "Alpha"
  }
]
:::
`),
      );
      const patch = resolveDocumintPatch(createTransition(previous, next), "rev-comments");

      expect(patch?.changes).toHaveLength(1);
      expect(patch?.changes[0]?.startLine).toBe(2);
      expect(patch?.changes[0]?.text).toContain("Resolved.");
      expectPatchApplies(previous, next, patch);
    });
  });

  describe("null fallbacks", () => {
    test("returns null for front matter metadata changes", () => {
      const previous = createEditorState(
        parseDocument("---\ntitle: Old\n---\n\nAlpha paragraph\n"),
      );
      const next = createEditorState(parseDocument("---\ntitle: New\n---\n\nAlpha paragraph\n"));

      expect(resolveDocumintPatch(createTransition(previous, next), "rev-front-matter")).toBeNull();
    });

    test("returns null for selection-only transitions", () => {
      const previous = setup("Alpha paragraph\n");
      const region = getRegion(previous, "Alpha paragraph");
      const next = placeAt(previous, region, "end");

      expect(resolveDocumintPatch(createTransition(previous, next), "rev-1")).toBeNull();
    });

    test("returns null for runtime empty document edits", () => {
      const previous = setup("");
      const region = getRegion(previous, "");
      const next = insertText(placeAt(previous, region, "start"), "Alpha");

      expect(next).not.toBeNull();
      expect(resolveDocumintPatch(createTransition(previous, next!), "rev-empty")).toBeNull();
    });
  });
});

type PatchEditCase = {
  edit: (
    state: Parameters<typeof createEditorStateTransition>[0],
  ) => Parameters<typeof createEditorStateTransition>[1] | null;
  expectedChanges: DocumintPatchChange[];
  markdown: string;
  revision: string | null;
};

function expectPatchFromEdit({ edit, expectedChanges, markdown, revision }: PatchEditCase) {
  const previous = setup(markdown);
  const next = edit(previous);

  if (!next) {
    throw new Error("Expected edit to produce a state.");
  }

  const patch = resolveDocumintPatch(createTransition(previous, next), revision);

  expect(patch).toEqual({
    changes: expectedChanges,
    revision,
  });
  expectPatchApplies(previous, next, patch);
}

function insertAtRegionText(
  state: Parameters<typeof createEditorStateTransition>[0],
  regionText: string,
  offset: number | "end" | "start",
  text: string,
) {
  const region = getRegion(state, regionText);
  return insertText(placeAt(state, region, offset), text);
}

function replaceInRegionText(
  state: Parameters<typeof createEditorStateTransition>[0],
  regionText: string,
  startOffset: number,
  endOffset: number,
  text: string,
) {
  const region = getRegion(state, regionText);
  return insertText(selectIn(state, region, startOffset, endOffset), text);
}

function createTransition(
  previous: Parameters<typeof createEditorStateTransition>[0],
  next: Parameters<typeof createEditorStateTransition>[1],
) {
  return createEditorStateTransition(previous, next, "local");
}

function expectPatchApplies(
  previous: Parameters<typeof createEditorStateTransition>[0],
  next: Parameters<typeof createEditorStateTransition>[1],
  patch: ReturnType<typeof resolveDocumintPatch>,
) {
  if (!patch) {
    throw new Error("Expected patch.");
  }

  expect(applyDocumintPatch(toMarkdown(previous), patch)).toBe(toMarkdown(next));
}
