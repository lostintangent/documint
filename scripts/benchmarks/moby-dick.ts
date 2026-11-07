import { indexedTextEntries } from "@test/editor/helpers";
import "../../test/setup-canvas";
import { createEditorLayoutState, createEditorState, createLayoutCache } from "@/editor";
import type { EditorLayoutState } from "@/editor/layout";
import { insertText, setSelection } from "@/editor/state";
import { parseDocument, serializeDocument } from "@/markdown";
import { paintDocumentFrame } from "@/renderer";
import {
  BENCHMARK_VIEWPORT,
  createBenchmarkDocumentFrame,
  roundMs,
  summarizeSamples,
} from "./harness";

const sourceUrl = "https://www.gutenberg.org/files/2701/2701-0.txt";
const cachePath = new URL("./.cache/moby-dick.txt", import.meta.url);
const viewport = {
  height: BENCHMARK_VIEWPORT.height,
  width: 900,
};

const rawText = await readMobyDickText();
const markdown = normalizeMobyDickMarkdown(stripProjectGutenbergEnvelope(rawText));

console.log("Moby-Dick fixture");
console.table([
  {
    bytes: Buffer.byteLength(markdown),
    characters: markdown.length,
    lines: markdown.split("\n").length,
  },
]);

const parseProfile = profileOnce("parse_markdown_to_document", () => parseDocument(markdown));
const document = parseProfile.value;
const indexProfile = profileOnce("create_documint_index", () => createEditorState(document));
const state = indexProfile.value;
const layoutCache = createLayoutCache();
const initialLayoutProfile = profileOnce("initial_virtual_layout", () =>
  createEditorLayoutState(state, { ...viewport, top: 0 }, layoutCache),
);
const initialLayout = initialLayoutProfile.value;
const openProfiles = [parseProfile, indexProfile, initialLayoutProfile];

console.log("Documint shape");
console.table([
  {
    blocks: document.blocks.length,
    paths: indexedTextEntries(state).length,
    linesInInitialPaintSlice: initialLayout.layout.lines.length,
    totalHeight: Math.round(initialLayout.layout.height),
  },
]);

console.log("Open path");
console.table([
  ...openProfiles.map(({ durationMs, name }) => ({ name, durationMs: roundMs(durationMs) })),
  {
    name: "open_total",
    durationMs: roundMs(openProfiles.reduce((total, { durationMs }) => total + durationMs, 0)),
  },
]);

const scrollOffsets = createScrollOffsets(initialLayout.layout.height, viewport.height, 240);
const paintContext = createNoopCanvasContext();
const paint = (layoutState: EditorLayoutState) => {
  paintContext.reset();
  paintDocumentFrame(paintContext, createBenchmarkDocumentFrame(state, layoutState, viewport));
};
const scrollAndPaint = [
  measureOffsets("scroll_layout_only", scrollOffsets, (top) => {
    void createEditorLayoutState(state, { ...viewport, top }, layoutCache);
  }),
  measureSamples("paint_prepared_viewport", 120, () => paint(initialLayout)),
  measureOffsets("scroll_layout_and_paint", scrollOffsets, (top) => {
    paint(createEditorLayoutState(state, { ...viewport, top }, layoutCache));
  }),
  measureOffsets(
    "cold_layout_at_deep_offsets",
    createScrollOffsets(initialLayout.layout.height, viewport.height, 16),
    (top) => {
      void createEditorLayoutState(state, { ...viewport, top }, createLayoutCache());
    },
  ),
];

console.log("Scroll and paint");
console.table(scrollAndPaint);

const bottleneck = scrollAndPaint.reduce((worst, row) => (row.p99Ms > worst.p99Ms ? row : worst));
const frameBudgetMs = 1000 / 60;

console.log(
  `Main bottleneck: ${bottleneck.name} (${bottleneck.p99Ms.toFixed(2)}ms, ${(
    bottleneck.p99Ms / frameBudgetMs
  ).toFixed(1)}x a 60fps frame).`,
);

const editTarget = indexedTextEntries(state).find((candidate) => candidate.text.length > 40);

if (!editTarget) {
  throw new Error("Expected an editable text path in Moby-Dick fixture.");
}

const editPoint = { offset: Math.floor(editTarget.text.length / 2), path: editTarget.path };
const typeAtEditPoint = () => {
  const next = insertText(setSelection(state, editPoint), " updated");

  if (!next) {
    throw new Error("Expected typing edit to produce a state.");
  }

  void serializeDocument(next.documentIndex.document);

  return next;
};

console.log("Edit path");
console.table([
  measureSamples("typing_full_edit", 120, typeAtEditPoint),
  measureSamples("typing_full_edit_with_layout", 80, () => {
    void createEditorLayoutState(typeAtEditPoint(), { ...viewport, top: 0 }, createLayoutCache());
  }),
]);

async function readMobyDickText() {
  const cache = Bun.file(cachePath);

  if (await cache.exists()) {
    return cache.text();
  }

  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();

  await Bun.write(cache, text);

  return text;
}

function stripProjectGutenbergEnvelope(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const startMatch = /^\*\*\* START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK .+ \*\*\*$/m.exec(
    normalized,
  );
  const endMatch = /^\*\*\* END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK .+ \*\*\*$/m.exec(
    normalized,
  );
  const bodyStart = startMatch ? startMatch.index + startMatch[0].length : 0;
  const bodyEnd = endMatch ? endMatch.index : normalized.length;

  return normalized.slice(bodyStart, bodyEnd).trimStart() + "\n";
}

function normalizeMobyDickMarkdown(text: string) {
  return splitParagraphs(text).map(normalizeMobyDickParagraph).join("\n\n").trimEnd() + "\n";
}

function splitParagraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trimEnd())
    .filter((paragraph) => paragraph.trim().length > 0);
}

function normalizeMobyDickParagraph(paragraph: string) {
  const lines = paragraph.split("\n").map((line) => line.replace(/^ {2}/, "").trimEnd());

  if (isMobyDickHeading(lines)) {
    return `## ${lines[0]!.trim()}`;
  }

  const etymologyTable = createEtymologyTable(lines);

  if (etymologyTable) {
    return etymologyTable;
  }

  return lines.map((line) => line.trim()).join(" ");
}

function isMobyDickHeading(lines: string[]) {
  if (lines.length !== 1) {
    return false;
  }

  const line = lines[0]!.trim();

  return (
    line === "ETYMOLOGY." ||
    line === "EXTRACTS." ||
    line.startsWith("CHAPTER ") ||
    /^[A-Z][A-Z0-9 ',;:!?().-]+$/.test(line)
  );
}

function createEtymologyTable(lines: string[]) {
  const rows = lines.flatMap((line) => {
    const match = /^(.+?),\s{2,}_(.+)_\.$/.exec(line.trim());

    return match ? [[match[1]!, match[2]!]] : [];
  });

  if (rows.length !== lines.length || rows.length < 3) {
    return null;
  }

  return [
    "| Term | Language |",
    "| --- | --- |",
    ...rows.map(([term, language]) => `| ${term} | _${language}_ |`),
  ].join("\n");
}

function createScrollOffsets(totalHeight: number, viewportHeight: number, frameCount: number) {
  const maxTop = Math.max(0, totalHeight - viewportHeight);

  if (frameCount <= 1 || maxTop === 0) {
    return [0];
  }

  return Array.from({ length: frameCount }, (_, index) =>
    Math.round((maxTop * index) / (frameCount - 1)),
  );
}

function profileOnce<T>(name: string, task: () => T) {
  const startedAt = performance.now();
  const value = task();

  return {
    durationMs: performance.now() - startedAt,
    name,
    value,
  };
}

// Times every sample after one discarded warmup run.
function measureSamples(name: string, iterations: number, task: () => void) {
  task();

  return summarizeDurations(
    name,
    Array.from({ length: iterations }, () => time(task)),
  );
}

// Times one cold sample per scroll offset and reports the slowest offset.
function measureOffsets(name: string, offsets: readonly number[], task: (top: number) => void) {
  const durations = offsets.map((top) => time(() => task(top)));

  return {
    ...summarizeDurations(name, durations),
    worstOffsetTop: offsets[durations.lastIndexOf(Math.max(...durations))],
  };
}

function summarizeDurations(name: string, durations: number[]) {
  const { p50Ms, p95Ms, p99Ms } = summarizeSamples(durations);

  return {
    name,
    samples: durations.length,
    p50Ms: roundMs(p50Ms),
    p95Ms: roundMs(p95Ms),
    p99Ms: roundMs(p99Ms),
    maxMs: roundMs(Math.max(...durations)),
  };
}

function time(task: () => void) {
  const startedAt = performance.now();

  task();

  return performance.now() - startedAt;
}

// Paint calls draw nothing, so samples time the renderer rather than
// rasterization. Canvas state still saves and restores like a real context.
function createNoopCanvasContext() {
  const noop = () => {};
  const stateStack: Array<Partial<typeof context>> = [];
  const context = {
    fillStyle: "" as string | CanvasGradient | CanvasPattern,
    font: "",
    globalAlpha: 1,
    globalCompositeOperation: "source-over" as GlobalCompositeOperation,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    lineWidth: 1,
    strokeStyle: "" as string | CanvasGradient | CanvasPattern,
    textAlign: "start" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    arc: noop,
    beginPath: noop,
    clearRect: noop,
    clip: noop,
    closePath: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    drawImage: noop,
    fill: noop,
    fillRect: noop,
    fillText: noop,
    lineTo: noop,
    measureText: (text: string) => ({
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
      width: text.length * 8,
    }),
    moveTo: noop,
    rect: noop,
    reset() {
      stateStack.length = 0;
    },
    restore() {
      Object.assign(context, stateStack.pop());
    },
    roundRect: noop,
    save() {
      const {
        fillStyle,
        font,
        globalAlpha,
        globalCompositeOperation,
        lineCap,
        lineJoin,
        lineWidth,
        strokeStyle,
        textAlign,
        textBaseline,
      } = context;

      stateStack.push({
        fillStyle,
        font,
        globalAlpha,
        globalCompositeOperation,
        lineCap,
        lineJoin,
        lineWidth,
        strokeStyle,
        textAlign,
        textBaseline,
      });
    },
    scale: noop,
    stroke: noop,
    strokeRect: noop,
    translate: noop,
  };

  return context as unknown as CanvasRenderingContext2D & { reset(): void };
}
