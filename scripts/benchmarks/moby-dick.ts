import "../../test/setup-canvas";
import { mkdirSync } from "fs";
import { createEditorLayoutState, createEditorState, createLayoutCache } from "@/editor";
import { insertText, normalizeSelection, setSelection, type EditorState } from "@/editor/state";
import { parseDocument, serializeDocument } from "@/markdown";
import { createDocumentFrame, paintDocumentFrame } from "@/renderer";
import { lightTheme, resolveEditorTheme } from "@/component/lib/themes";
import { summarizeSamples } from "./stats";
import { BENCHMARK_VIEWPORT } from "./harness";

type MobyDickSampleRecord = {
  iterations: number;
  kind: "sample";
  name: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

type MobyDickOffsetDistributionRecord = {
  kind: "offset-distribution";
  maxDurationMs: number;
  name: string;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  sampleCount: number;
  worstOffsetTop: number;
};

type MobyDickProfileRecord = {
  durationMs: number;
  kind: "profile-once";
  name: string;
};

type MobyDickRecord =
  | MobyDickOffsetDistributionRecord
  | MobyDickProfileRecord
  | MobyDickSampleRecord;

const sourceUrl = "https://www.gutenberg.org/files/2701/2701-0.txt";
const cacheDirectory = new URL("./.cache/", import.meta.url);
const cachePath = new URL("moby-dick.txt", cacheDirectory);
const viewport = {
  height: BENCHMARK_VIEWPORT.height,
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
  formatRecord(summarizeProfile(parseProfile)),
  formatRecord(summarizeProfile(indexProfile)),
  formatRecord(summarizeProfile(initialLayoutProfile)),
  formatRecord({
    name: "open_total",
    kind: "profile-once",
    durationMs: parseProfile.durationMs + indexProfile.durationMs + initialLayoutProfile.durationMs,
  }),
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
  paintDocumentFrame(
    paintContext as unknown as CanvasRenderingContext2D,
    createDocumentFrame(state, initialLayout, createPaintOptions(state)),
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
  paintDocumentFrame(
    paintContext as unknown as CanvasRenderingContext2D,
    createDocumentFrame(state, layout, createPaintOptions(state)),
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
console.table([
  formatDurationRecord(layoutScroll),
  formatDurationRecord(paintAtPreparedTop),
  formatDurationRecord(scrollLayoutAndPaint),
  formatDurationRecord(coldLayoutAtDeepOffsets),
]);

const bottleneck = [layoutScroll, paintAtPreparedTop, scrollLayoutAndPaint, coldLayoutAtDeepOffsets]
  .slice()
  .sort((left, right) => getPrimaryDurationMs(right) - getPrimaryDurationMs(left))[0]!;
const frameBudgetMs = 1000 / 60;

console.log(
  `Main bottleneck: ${bottleneck.name} (${getPrimaryDurationMs(bottleneck).toFixed(2)}ms, ${(
    getPrimaryDurationMs(bottleneck) / frameBudgetMs
  ).toFixed(1)}x a 60fps frame).`,
);

const editFixture = createTypingEditFixture(state);
const typingFullEdit = runTypingBenchmarkSamples("typing_full_edit", 120, editFixture);
const typingFullEditWithLayout = runTypingBenchmarkSamples(
  "typing_full_edit_with_layout",
  80,
  editFixture,
  (nextState) => {
    void createEditorLayoutState(nextState, { ...viewport, top: 0 }, createLayoutCache());
  },
);

console.log("Edit path");
console.table([typingFullEdit, typingFullEditWithLayout].map(formatRecord));

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

function createTypingEditFixture(baseState: EditorState) {
  const region = baseState.documentIndex.regions.find((candidate) => candidate.text.length > 40);

  if (!region) {
    throw new Error("Expected an editable text region in Moby-Dick fixture.");
  }

  return {
    offset: Math.floor(region.text.length / 2),
    regionId: region.id,
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
    kind: "profile-once" as const,
    name: profile.name,
    durationMs: profile.durationMs,
  };
}

function runBenchmarkSamples(
  name: string,
  iterations: number,
  task: () => void,
): MobyDickSampleRecord {
  const samples: number[] = [];

  task();

  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();

    task();
    samples.push(performance.now() - startedAt);
  }

  const summary = summarizeSamples(samples);

  return {
    iterations,
    kind: "sample",
    name,
    p50Ms: summary.p50Ms,
    p95Ms: summary.p95Ms,
    p99Ms: summary.p99Ms,
  };
}

function runTypingBenchmarkSamples(
  name: string,
  iterations: number,
  fixture: ReturnType<typeof createTypingEditFixture>,
  afterEdit?: (nextState: EditorState) => void,
): MobyDickSampleRecord {
  return runBenchmarkSamples(name, iterations, () => {
    const previous = setSelection(state, {
      offset: fixture.offset,
      regionId: fixture.regionId,
    });
    const next = insertText(previous, " updated");

    if (!next) {
      throw new Error(`Expected typing edit to produce a state for ${name}.`);
    }

    void serializeDocument(next.documentIndex.document);
    afterEdit?.(next);
  });
}

function runFrameBenchmark(name: string, offsets: readonly number[], task: (top: number) => void) {
  const samples: Array<{ durationMs: number; offsetTop: number }> = [];

  for (const top of offsets) {
    const startedAt = performance.now();

    task(top);
    samples.push({
      durationMs: performance.now() - startedAt,
      offsetTop: top,
    });
  }

  samples.sort((left, right) => left.durationMs - right.durationMs);
  const durations = samples.map((sample) => sample.durationMs);
  const summary = summarizeSamples(durations);
  const worstSample = samples[samples.length - 1]!;

  return {
    kind: "offset-distribution" as const,
    maxDurationMs: durations[durations.length - 1]!,
    name,
    p50DurationMs: summary.p50Ms,
    p95DurationMs: summary.p95Ms,
    p99DurationMs: summary.p99Ms,
    sampleCount: offsets.length,
    worstOffsetTop: worstSample.offsetTop,
  };
}

function formatRecord(record: MobyDickRecord) {
  switch (record.kind) {
    case "offset-distribution":
      return {
        kind: record.kind,
        maxDurationMs: roundMs(record.maxDurationMs),
        name: record.name,
        p50DurationMs: roundMs(record.p50DurationMs),
        p95DurationMs: roundMs(record.p95DurationMs),
        p99DurationMs: roundMs(record.p99DurationMs),
        sampleCount: record.sampleCount,
        worstOffsetTop: record.worstOffsetTop,
      };
    case "profile-once":
      return {
        durationMs: roundMs(record.durationMs),
        kind: record.kind,
        name: record.name,
      };
    case "sample":
      return {
        iterations: record.iterations,
        kind: record.kind,
        name: record.name,
        p50Ms: roundMs(record.p50Ms),
        p95Ms: roundMs(record.p95Ms),
        p99Ms: roundMs(record.p99Ms),
      };
  }
}

function formatDurationRecord(record: MobyDickOffsetDistributionRecord | MobyDickSampleRecord) {
  return record.kind === "offset-distribution"
    ? {
        kind: record.kind,
        maxDurationMs: roundMs(record.maxDurationMs),
        name: record.name,
        p50DurationMs: roundMs(record.p50DurationMs),
        p95DurationMs: roundMs(record.p95DurationMs),
        p99DurationMs: roundMs(record.p99DurationMs),
        sampleCount: record.sampleCount,
        worstOffsetTop: record.worstOffsetTop,
      }
    : {
        kind: record.kind,
        maxDurationMs: "",
        name: record.name,
        p50DurationMs: roundMs(record.p50Ms),
        p95DurationMs: roundMs(record.p95Ms),
        p99DurationMs: roundMs(record.p99Ms),
        sampleCount: record.iterations,
        worstOffsetTop: "",
      };
}

function getPrimaryDurationMs(record: MobyDickOffsetDistributionRecord | MobyDickSampleRecord) {
  return record.kind === "offset-distribution" ? record.p99DurationMs : record.p99Ms;
}

function roundMs(value: number) {
  return Number(value.toFixed(3));
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
