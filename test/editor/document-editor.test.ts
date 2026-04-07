import { expect, test } from "bun:test";
import {
  createDocumentEditorAdapter,
  createDocumentEditor,
  normalizeCanvasSelection,
  replaceText,
} from "@/editor/model/document-editor";
import { parseMarkdown, serializeMarkdown } from "@/markdown";

test("projects semantic snapshots into a deterministic editor document", () => {
  const snapshot = parseMarkdown(`# Runtime

Paragraph with [link](https://example.com), \`code\`, and ![alt text](https://example.com/image.png).

- alpha
- beta
`);
  const runtime = createDocumentEditor(snapshot);

  expect(runtime.engine).toBe("canvas");
  expect(runtime.blocks.map((block) => block.type)).toEqual([
    "heading",
    "paragraph",
    "list",
    "listItem",
    "paragraph",
    "listItem",
    "paragraph",
  ]);
  expect(runtime.regions.map((container) => container.text)).toEqual([
    "Runtime",
    "Paragraph with link, code, and \uFFFC.",
    "alpha",
    "beta",
  ]);
  expect(runtime.regions[1]?.runs.map((run) => run.kind)).toEqual([
    "text",
    "text",
    "text",
    "inlineCode",
    "text",
    "image",
    "text",
  ]);
  expect(runtime.regions[1]?.runs[1]?.link?.url).toBe("https://example.com");
  expect(runtime.regions[1]?.runs[5]?.text).toBe("\uFFFC");
  expect(runtime.regions[1]?.runs[5]?.image?.alt).toBe("alt text");
  expect(runtime.text).toContain("Paragraph with link, code, and \uFFFC.");
  expect(runtime.length).toBe(runtime.text.length);
});

test("preserves inline emphasis and strong marks in runtime text runs", () => {
  const runtime = createDocumentEditor(
    parseMarkdown("Plain *italic* and **bold** text.\n"),
  );
  const paragraph = runtime.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  const italicRun = paragraph.runs.find((run) => run.text === "italic");
  const boldRun = paragraph.runs.find((run) => run.text === "bold");

  expect(italicRun?.marks).toEqual(["italic"]);
  expect(boldRun?.marks).toEqual(["bold"]);
});

test("preserves inline underline marks in runtime text runs", () => {
  const runtime = createDocumentEditor(
    parseMarkdown("Plain <ins>underlined</ins> text.\n"),
  );
  const paragraph = runtime.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  const underlineRun = paragraph.runs.find((run) => run.text === "underlined");

  expect(underlineRun?.marks).toEqual(["underline"]);
});

test("round-trips through the canvas runtime adapter without changing markdown", () => {
  const markdown = `# Canvas Runtime

> quoted

- [ ] task
`;
  const snapshot = parseMarkdown(markdown);
  const adapter = createDocumentEditorAdapter();
  const runtime = adapter.createState(snapshot);
  const roundTrip = adapter.createDocument(runtime);

  expect(serializeMarkdown(roundTrip)).toBe(markdown);
});

test("keeps a runtime adapter boundary for the canvas engine", () => {
  const markdown = "# Adapter\n\nParagraph.\n";
  const snapshot = parseMarkdown(markdown);
  const canvasAdapter = createDocumentEditorAdapter();

  expect(canvasAdapter.engine).toBe("canvas");
  expect(serializeMarkdown(canvasAdapter.createDocument(canvasAdapter.createState(snapshot)))).toBe(
    markdown,
  );
});

test("creates a runtime paragraph for an empty document without changing markdown persistence", () => {
  const snapshot = parseMarkdown("");
  const runtime = createDocumentEditor(snapshot);
  const adapter = createDocumentEditorAdapter();

  expect(runtime.regions).toHaveLength(1);
  expect(runtime.regions[0]?.text).toBe("");
  expect(runtime.document.blocks[0]?.type).toBe("paragraph");
  expect(serializeMarkdown(adapter.createDocument(runtime))).toBe("");
});

test("normalizes canvas selections and replaces plain text within one container", () => {
  const runtime = createDocumentEditor(
    parseMarkdown(`# Selection

Paragraph body.
`),
  );
  const paragraphContainer = runtime.regions[1];

  if (!paragraphContainer) {
    throw new Error("Expected paragraph container");
  }

  const normalized = normalizeCanvasSelection(runtime, {
    anchor: {
      regionId: paragraphContainer.id,
      offset: 12,
    },
    focus: {
      regionId: paragraphContainer.id,
      offset: 10,
    },
  });
  const replaced = replaceText(runtime, {
    anchor: {
      regionId: paragraphContainer.id,
      offset: 10,
    },
    focus: {
      regionId: paragraphContainer.id,
      offset: 14,
    },
  }, "text");

  expect(normalized.start.offset).toBe(10);
  expect(normalized.end.offset).toBe(12);
  expect(replaced.documentEditor.regions[1]?.text).toBe("Paragraph text.");
  expect(serializeMarkdown(replaced.documentEditor.document)).toContain("Paragraph text.");
});

test("preserves inline semantic wrappers when editing inside a formatted container", () => {
  const runtime = createDocumentEditor(
    parseMarkdown("Paragraph with [link](https://example.com), `code`, and ![alt](https://example.com/image.png).\n"),
  );
  const paragraph = runtime.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  const replacedLink = replaceText(
    runtime,
    {
      anchor: {
        regionId: paragraph.id,
        offset: "Paragraph with ".length,
      },
      focus: {
        regionId: paragraph.id,
        offset: "Paragraph with link".length,
      },
    },
    "ref",
  );
  const replacedCode = replaceText(
    replacedLink.documentEditor,
    {
      anchor: {
        regionId: replacedLink.documentEditor.regions[0]!.id,
        offset: "Paragraph with ref, ".length,
      },
      focus: {
        regionId: replacedLink.documentEditor.regions[0]!.id,
        offset: "Paragraph with ref, code".length,
      },
    },
    "snippet",
  );

  expect(serializeMarkdown(replacedCode.documentEditor.document)).toBe(
    "Paragraph with [ref](https://example.com), `snippet`, and ![alt](https://example.com/image.png).\n",
  );
});

test("replaces a selected image atomically instead of editing its alt text", () => {
  const runtime = createDocumentEditor(
    parseMarkdown("before ![alt](https://example.com/image.png) after\n"),
  );
  const paragraph = runtime.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  const imageRun = paragraph.runs.find((run) => run.kind === "image");

  if (!imageRun) {
    throw new Error("Expected image run");
  }

  const replaced = replaceText(
    runtime,
    {
      anchor: {
        regionId: paragraph.id,
        offset: imageRun.start,
      },
      focus: {
        regionId: paragraph.id,
        offset: imageRun.end,
      },
    },
    "media",
  );

  expect(serializeMarkdown(replaced.documentEditor.document)).toBe("before media after\n");
});
