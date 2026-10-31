import { describe, expect, test } from "bun:test";
import { createRenderScheduler } from "@/component/hooks/useRender";
import type { RendererEffect, RendererEffectInput } from "@/renderer";

type RenderStep = "commit" | "content" | "overlay";

describe("render frames", () => {
  test.each([
    ["a full render", ["scheduleFullRender"], ["commit", "content", "overlay"]],
    ["a full paint", ["scheduleFullPaint"], ["content", "overlay"]],
    ["a content paint", ["scheduleContentPaint"], ["content"]],
    ["an overlay paint", ["scheduleOverlayPaint"], ["overlay"]],
    [
      "content and overlay paints",
      ["scheduleOverlayPaint", "scheduleContentPaint"],
      ["content", "overlay"],
    ],
    [
      "every intent at once",
      ["scheduleOverlayPaint", "scheduleContentPaint", "scheduleFullPaint", "scheduleFullRender"],
      ["commit", "content", "overlay"],
    ],
  ] as const)("runs exactly the needed steps in order for %s", (_label, calls, expectedSteps) => {
    const harness = createHarness();

    for (const call of calls) {
      harness.scheduler[call]();
    }

    expect(harness.runFrame()).toEqual(expectedSteps);
    expect(harness.recordedFrames).toHaveLength(1);
    expect(harness.pendingFrames).toBe(0);
  });

  test("coalesces repeated requests into one frame", () => {
    const harness = createHarness();

    harness.scheduler.scheduleContentPaint();
    harness.scheduler.scheduleOverlayPaint();
    harness.scheduler.scheduleContentPaint();
    harness.scheduler.scheduleOverlayPaint();

    expect(harness.pendingFrames).toBe(1);
    expect(harness.runFrame()).toEqual(["content", "overlay"]);
    expect(harness.pendingFrames).toBe(0);
  });

  test("requests a fresh frame for work scheduled after a flush", () => {
    const harness = createHarness();

    harness.scheduler.scheduleFullRender();
    harness.runFrame();
    harness.scheduler.scheduleOverlayPaint();

    expect(harness.pendingFrames).toBe(1);
    expect(harness.runFrame()).toEqual(["overlay"]);
  });
});

describe("paint continuation", () => {
  test("keeps painting content while renderer effects stay active", () => {
    const harness = createHarness({
      paintContent: (effects, paintCount) => (paintCount < 2 ? effects : []),
    });

    harness.scheduler.scheduleContentPaint({ effects: [activeBlockEffect("root.0")] });
    harness.scheduler.scheduleContentPaint({ effects: [activeBlockEffect("root.1")] });

    expect(harness.runFrame()).toEqual(["content"]);
    const [firstPaint] = harness.paintedEffects;
    expect(
      firstPaint!.map((effect) => effect.kind === "active-block-changed" && effect.blockPath),
    ).toEqual(["root.0", "root.1"]);
    expect(firstPaint![0]!.startedAt).toBeNumber();
    expect(firstPaint![1]!.startedAt).toBeGreaterThanOrEqual(firstPaint![0]!.startedAt);
    expect(harness.pendingFrames).toBe(1);

    expect(harness.runFrame()).toEqual(["content"]);
    expect(harness.paintedEffects[1]).toBe(firstPaint!);
    expect(harness.pendingFrames).toBe(0);
  });

  test("continues full renders with content-only frames", () => {
    const harness = createHarness({
      paintContent: (effects, paintCount) => (paintCount < 2 ? effects : []),
    });

    harness.scheduler.scheduleContentPaint({ effects: [activeBlockEffect("root.0")] });
    harness.scheduler.scheduleFullRender();

    expect(harness.runFrame()).toEqual(["commit", "content", "overlay"]);
    expect(harness.runFrame()).toEqual(["content"]);
    expect(harness.recordedFrames).toHaveLength(2);
    expect(harness.pendingFrames).toBe(0);
  });

  test.each([
    ["idle with ambient animations", { active: false, ambient: true }, 1],
    ["active with ambient animations", { active: true, ambient: true }, 0],
    ["idle without ambient animations", { active: false, ambient: false }, 0],
  ] as const)(
    "decides ambient continuation for an editor %s",
    (_label, options, expectedFrames) => {
      const harness = createHarness(options);

      harness.scheduler.scheduleFullPaint();
      harness.runFrame();

      expect(harness.pendingFrames).toBe(expectedFrames);
    },
  );

  test("never continues from overlay-only frames", () => {
    const harness = createHarness({ active: false, ambient: true });

    harness.scheduler.scheduleOverlayPaint();
    harness.runFrame();

    expect(harness.pendingFrames).toBe(0);
  });
});

describe("cancellation", () => {
  test("drops the pending frame but keeps its work for the next frame", () => {
    const harness = createHarness();

    harness.scheduler.scheduleFullRender();
    harness.scheduler.cancel();

    expect(harness.pendingFrames).toBe(0);

    harness.scheduler.scheduleOverlayPaint();

    expect(harness.pendingFrames).toBe(1);
    expect(harness.runFrame()).toEqual(["commit", "content", "overlay"]);
  });
});

function createHarness(
  options: {
    active?: boolean;
    ambient?: boolean;
    paintContent?: (
      effects: readonly RendererEffect[],
      paintCount: number,
    ) => readonly RendererEffect[];
  } = {},
) {
  const frames: (() => void)[] = [];
  const paintedEffects: (readonly RendererEffect[])[] = [];
  const recordedFrames: number[] = [];
  let steps: RenderStep[] = [];

  const scheduler = createRenderScheduler({
    commitLayout: () => {
      steps.push("commit");
    },
    hasAmbientAnimationsInViewport: () => options.ambient ?? false,
    isActive: () => options.active ?? false,
    paintContent: (effects) => {
      steps.push("content");
      paintedEffects.push(effects);
      return options.paintContent?.(effects, paintedEffects.length) ?? [];
    },
    paintOverlay: () => {
      steps.push("overlay");
    },
    recordFrame: (durationMs) => {
      recordedFrames.push(durationMs);
    },
    requestFrame: (flush) => {
      frames.push(flush);
      return () => {
        frames.splice(frames.indexOf(flush), 1);
      };
    },
  });

  return {
    paintedEffects,
    recordedFrames,
    scheduler,
    get pendingFrames() {
      return frames.length;
    },
    runFrame(): readonly RenderStep[] {
      const flush = frames.shift();
      if (!flush) {
        throw new Error("Expected a requested frame");
      }

      steps = [];
      flush();
      return steps;
    },
  };
}

function activeBlockEffect(blockPath: string): RendererEffectInput {
  return { kind: "active-block-changed", blockPath };
}
