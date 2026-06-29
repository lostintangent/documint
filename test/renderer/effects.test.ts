import { describe, expect, test } from "bun:test";
import {
  defaultEffectPolicy,
  type EffectPolicy,
  resolveRendererEffects,
  type RendererEffect,
} from "@/renderer/effects";

const startedAt = 100;
const now = 110;

describe("Renderer effect policy", () => {
  describe("text insertion", () => {
    test("maps ordinary inserted text to a highlight", () => {
      const resolvedEffects = resolveRendererEffects([insertedText("x")], now);

      expect(resolvedEffects.textHighlights.get("root.0")).toEqual([
        expect.objectContaining({ endOffset: 5, startOffset: 4 }),
      ]);
      expect(resolvedEffects.textPulses.get("root.0")).toBeUndefined();
    });

    test("maps period insertion to a text pulse", () => {
      const resolvedEffects = resolveRendererEffects([insertedText(".")], now);

      expect(resolvedEffects.textPulses.get("root.0")).toEqual([
        expect.objectContaining({ startOffset: 4 }),
      ]);
      expect(resolvedEffects.textHighlights.get("root.0")).toBeUndefined();
    });

    test("does not keep color emoji insertion active by default", () => {
      const effects = [insertedText("🔥")];
      const resolvedEffects = resolveRendererEffects(effects, now);

      expect(resolvedEffects.textHighlights.size).toBe(0);
      expect(resolvedEffects.rendererEffects).toEqual([]);
    });

    test("does not animate source-region insertion by default", () => {
      const effects = [insertedText("x", { regionKind: "source" })];
      const resolvedEffects = resolveRendererEffects(effects, now);

      expect(resolvedEffects.textHighlights.size).toBe(0);
      expect(resolvedEffects.textPulses.size).toBe(0);
      expect(resolvedEffects.rendererEffects).toEqual([]);
    });
  });

  describe("text deletion", () => {
    test("maps plain backward line-end deletion to a fade", () => {
      const resolvedEffects = resolveRendererEffects([deletedText()], now);

      expect(resolvedEffects.textFades.get("root.0")).toEqual([
        expect.objectContaining({ startOffset: 3, text: "a" }),
      ]);
    });

    test("does not keep forward, middle, styled, or emoji deletion active by default", () => {
      const effects = [
        deletedText({ direction: "forward", placement: "line-middle" }),
        deletedText({ placement: "line-middle" }),
        deletedText({ textKind: "styled" }),
        deletedText({ text: "🔥" }),
      ];

      const resolvedEffects = resolveRendererEffects(effects, now);

      expect(resolvedEffects.textFades.size).toBe(0);
      expect(resolvedEffects.rendererEffects).toEqual([]);
    });

    test("does not animate source-region deletion by default", () => {
      const effects = [deletedText({ regionKind: "source" })];
      const resolvedEffects = resolveRendererEffects(effects, now);

      expect(resolvedEffects.textFades.size).toBe(0);
      expect(resolvedEffects.rendererEffects).toEqual([]);
    });
  });

  test("keeps only effects accepted by the default policy active", () => {
    const running = insertedText("x");
    const skipped = insertedText("🔥");

    expect(resolveRendererEffects([running, skipped], now).rendererEffects).toEqual([running]);
  });

  test("maps document-change effects to fade frames", () => {
    const effect = documentChangeEffect();
    const resolvedEffects = resolveRendererEffects([effect], now);

    expect(resolvedEffects.documentChangeFades.get("change-1")).toEqual({
      progress: 10 / 420,
    });
    expect(resolvedEffects.rendererEffects).toEqual([effect]);
    expect(resolveRendererEffects([effect], startedAt + 500).rendererEffects).toEqual([]);
  });

  describe("custom duration policy", () => {
    test("can disable default handling for an effect", () => {
      const effect = insertedText("x");
      const policy = withDurationOverride((currentEffect) =>
        currentEffect.kind === "text-inserted"
          ? null
          : defaultEffectPolicy.duration(currentEffect),
      );

      const resolvedEffects = resolveRendererEffects([effect], now, policy);

      expect(resolvedEffects.textHighlights.size).toBe(0);
      expect(resolvedEffects.rendererEffects).toEqual([]);
    });

    test("can extend the running lifetime for an effect", () => {
      const effect = insertedText("x");
      const afterDefaultExpiration = startedAt + 1200;
      const policy = withDurationOverride((currentEffect) =>
        currentEffect.kind === "text-inserted"
          ? 1500
          : defaultEffectPolicy.duration(currentEffect),
      );

      expect(resolveRendererEffects([effect], afterDefaultExpiration).rendererEffects).toEqual(
        [],
      );
      expect(
        resolveRendererEffects([effect], afterDefaultExpiration, policy).rendererEffects,
      ).toEqual([effect]);
      expect(
        resolveRendererEffects([effect], afterDefaultExpiration, policy).textHighlights.size,
      ).toBe(1);
    });

    test("can opt into default visual mapping for effects the default policy skips", () => {
      const effect = insertedText("🔥");
      const policy = withDurationOverride((currentEffect) =>
        currentEffect.kind === "text-inserted"
          ? 1000
          : defaultEffectPolicy.duration(currentEffect),
      );

      expect(resolveRendererEffects([effect], now).textHighlights.size).toBe(0);
      expect(resolveRendererEffects([effect], now, policy).textHighlights.size).toBe(1);
    });
  });

  describe("custom effect handlers", () => {
    test("keep matching semantic effects active when the default policy skips them", () => {
      const insertedEmoji = insertedText("🔥");
      const forwardDelete = deletedText({ direction: "forward", placement: "line-middle" });

      expect(resolveRendererEffects([insertedEmoji, forwardDelete], now).rendererEffects).toEqual(
        [],
      );
      expect(
        resolveRendererEffects(
          [insertedEmoji, forwardDelete],
          now,
          defaultEffectPolicy,
          {
            textDeleted: () => {},
            textInserted: () => {},
          },
        ).rendererEffects,
      ).toEqual([insertedEmoji, forwardDelete]);
    });
  });
});

function withDurationOverride(duration: EffectPolicy["duration"]): EffectPolicy {
  return { duration };
}

function insertedText(
  text: string,
  overrides: Partial<Extract<RendererEffect, { kind: "text-inserted" }>> = {},
): RendererEffect {
  return {
    kind: "text-inserted",
    text,
    regionKind: "inlines",
    regionPath: "root.0",
    startOffset: 4,
    endOffset: 4 + text.length,
    startedAt,
    ...overrides,
  };
}

function deletedText(
  overrides: Partial<Extract<RendererEffect, { kind: "text-deleted" }>> = {},
): RendererEffect {
  return {
    kind: "text-deleted",
    text: "a",
    regionKind: "inlines",
    regionPath: "root.0",
    startOffset: 3,
    direction: "backward",
    placement: "line-end",
    textKind: "plain",
    startedAt,
    ...overrides,
  };
}

function documentChangeEffect(): RendererEffect {
  return {
    changeKey: "change-1",
    changeKind: "modified",
    kind: "document-change",
    startedAt,
    target: { blockPath: "root.0", kind: "block" },
  };
}
