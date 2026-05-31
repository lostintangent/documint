import "../../test/setup-canvas";
import { mkdirSync } from "fs";
import { createEditorLayoutState, createEditorState, createLayoutCache } from "@/editor";
import { normalizeSelection, type EditorState } from "@/editor/state";
import { parseDocument } from "@/markdown";
import { paintContent } from "@/renderer";
import { lightTheme, resolveEditorTheme } from "@/component/lib/themes";
import type { BenchmarkRecord } from "./shared";
import { percentile } from "./shared";

const sourceUrl = "https://www.gutenberg.org/files/2701/2701-0.txt";
const cacheDirectory = new URL("./.cache/", import.meta.url);
const cachePath = new URL("moby-dick.txt", cacheDirectory);
const viewport = {
  height: 720,
  width: 900,
};
const theme = resolveEditorTheme(lightTheme);

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
  createEditorLayoutState(
    state,
    {
      ...viewport,
      top: 0,
    },
    layoutCache,
  ),
);
const initialLayout = initialLayoutProfile.value;

console.log("Documint shape");
console.table([
  {
    blocks: document.blocks.length,
    regions: state.documentIndex.regions.length,
    linesInInitialPaintSlice: initialLayout.layout.lines.length,
    totalHeight: Math.round(initialLayout.totalHeight),
  },
]);

console.log("Open path");
console.table([
  summarizeProfile(parseProfile),
  summarizeProfile(indexProfile),
  summarizeProfile(initialLayoutProfile),
  {
    name: "open_total",
    durationMs: parseProfile.durationMs + indexProfile.durationMs + initialLayoutProfile.durationMs,
  },
]);

const scrollOffsets = createScrollOffsets(initialLayout.totalHeight, viewport.height, 240);
const paintContext = createNoopCanvasContext();

const layoutScroll = runFrameBenchmark("scroll_layout_only", scrollOffsets, (top) => {
  void createEditorLayoutState(
    state,
    {
      ...viewport,
      top,
    },
    layoutCache,
  );
});

const paintAtPreparedTop = runBenchmarkSamples("paint_prepared_viewport", 120, () => {
  paintContext.reset();
  paintContent(
    state,
    initialLayout,
    paintContext as unknown as CanvasRenderingContext2D,
    createPaintOptions(state),
  );
});

const scrollLayoutAndPaint = runFrameBenchmark("scroll_layout_and_paint", scrollOffsets, (top) => {
  const layout = createEditorLayoutState(
    state,
    {
      ...viewport,
      top,
    },
    layoutCache,
  );

  paintContext.reset();
  paintContent(
    state,
    layout,
    paintContext as unknown as CanvasRenderingContext2D,
    createPaintOptions(state),
  );
});

const coldLayoutAtDeepOffsets = runFrameBenchmark(
  "cold_layout_at_deep_offsets",
  createScrollOffsets(initialLayout.totalHeight, viewport.height, 16),
  (top) => {
    void createEditorLayoutState(
      state,
      {
        ...viewport,
        top,
      },
      createLayoutCache(),
    );
  },
);

console.log("Scroll and paint");
console.table(
  [layoutScroll, paintAtPreparedTop, scrollLayoutAndPaint, coldLayoutAtDeepOffsets].map(
    formatRecord,
  ),
);

const bottleneck = [layoutScroll, paintAtPreparedTop, scrollLayoutAndPaint, coldLayoutAtDeepOffsets]
  .slice()
  .sort((left, right) => right.p99Ms - left.p99Ms)[0]!;
const frameBudgetMs = 1000 / 60;

console.log(
  `Main p99 bottleneck: ${bottleneck.name} (${bottleneck.p99Ms.toFixed(2)}ms, ${(
    bottleneck.p99Ms / frameBudgetMs
  ).toFixed(1)}x a 60fps frame).`,
);

async function readMobyDickText() {
  if (await Bun.file(cachePath).exists()) {
    return Bun.file(cachePath).text();
  }

  mkdirSync(cacheDirectory, { recursive: true });

  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${sourceUrl}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();

  await Bun.write(cachePath, text);

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

function createPaintOptions(state: EditorState) {
  return {
    activeBlockId:
      state.documentIndex.regionIndex.get(state.selection.focus.regionId)?.block.id ?? null,
    activeRegionId: state.selection.focus.regionId,
    activeThreadIndex: null,
    commentRanges: [],
    devicePixelRatio: 1,
    height: viewport.height,
    normalizedSelection: normalizeSelection(state),
    now: 0,
    theme,
    width: viewport.width,
  };
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

function summarizeProfile(profile: ReturnType<typeof profileOnce>) {
  return {
    name: profile.name,
    durationMs: profile.durationMs,
  };
}

function runBenchmarkSamples(name: string, iterations: number, task: () => void): BenchmarkRecord {
  const samples: number[] = [];

  task();

  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();

    task();
    samples.push(performance.now() - startedAt);
  }

  samples.sort((left, right) => left - right);

  return {
    iterations,
    name,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
  };
}

function runFrameBenchmark(name: string, offsets: readonly number[], task: (top: number) => void) {
  const samples: number[] = [];

  for (const top of offsets) {
    const startedAt = performance.now();

    task(top);
    samples.push(performance.now() - startedAt);
  }

  samples.sort((left, right) => left - right);

  return {
    iterations: offsets.length,
    name,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
  };
}

function formatRecord(record: BenchmarkRecord) {
  return {
    iterations: record.iterations,
    name: record.name,
    p50Ms: Number(record.p50Ms.toFixed(3)),
    p95Ms: Number(record.p95Ms.toFixed(3)),
    p99Ms: Number(record.p99Ms.toFixed(3)),
  };
}

function createNoopCanvasContext() {
  const context = {
    fillStyle: "" as string | CanvasGradient | CanvasPattern,
    font: "",
    globalAlpha: 1,
    globalCompositeOperation: "source-over" as GlobalCompositeOperation,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    lineWidth: 1,
    stateStack: [] as Array<{
      fillStyle: string | CanvasGradient | CanvasPattern;
      font: string;
      globalAlpha: number;
      globalCompositeOperation: GlobalCompositeOperation;
      lineCap: CanvasLineCap;
      lineJoin: CanvasLineJoin;
      lineWidth: number;
      strokeStyle: string | CanvasGradient | CanvasPattern;
      textAlign: CanvasTextAlign;
      textBaseline: CanvasTextBaseline;
    }>,
    strokeStyle: "" as string | CanvasGradient | CanvasPattern,
    textAlign: "start" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    arc() {},
    beginPath() {},
    clearRect() {},
    clip() {},
    closePath() {},
    createLinearGradient(): CanvasGradient {
      return {
        addColorStop() {},
      } as CanvasGradient;
    },
    drawImage() {},
    fill() {},
    fillRect() {},
    fillText() {},
    lineTo() {},
    measureText(text: string) {
      return {
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 3,
        width: text.length * 8,
      } as TextMetrics;
    },
    moveTo() {},
    rect() {},
    reset() {
      context.stateStack = [];
    },
    restore() {
      const state = context.stateStack.pop();

      if (!state) {
        return;
      }

      context.fillStyle = state.fillStyle;
      context.font = state.font;
      context.globalAlpha = state.globalAlpha;
      context.globalCompositeOperation = state.globalCompositeOperation;
      context.lineCap = state.lineCap;
      context.lineJoin = state.lineJoin;
      context.lineWidth = state.lineWidth;
      context.strokeStyle = state.strokeStyle;
      context.textAlign = state.textAlign;
      context.textBaseline = state.textBaseline;
    },
    roundRect() {},
    save() {
      context.stateStack.push({
        fillStyle: context.fillStyle,
        font: context.font,
        globalAlpha: context.globalAlpha,
        globalCompositeOperation: context.globalCompositeOperation,
        lineCap: context.lineCap,
        lineJoin: context.lineJoin,
        lineWidth: context.lineWidth,
        strokeStyle: context.strokeStyle,
        textAlign: context.textAlign,
        textBaseline: context.textBaseline,
      });
    },
    scale() {},
    stroke() {},
    strokeRect() {},
    translate() {},
  };

  return context;
}
