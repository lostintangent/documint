import { describe, expect, test } from "bun:test";
import {
  defaultEffectPolicy,
  type EffectPolicy,
  resolveActiveEffects,
  type ActiveEditorEffect,
} from "@/renderer/effects";

const startedAt = 100;
const now = 110;

describe("Renderer effect policy", () => {
  describe("text insertion", () => {
    test("maps ordinary inserted text to a highlight", () => {
      const activeEffects = resolveActiveEffects([insertedText("x")], now);

      expect(activeEffects.textHighlights.get("root.0")).toEqual([
        expect.objectContaining({ endOffset: 5, startOffset: 4 }),
      ]);
      expect(activeEffects.textPulses.get("root.0")).toBeUndefined();
    });

    test("maps period insertion to a text pulse", () => {
      const activeEffects = resolveActiveEffects([insertedText(".")], now);

      expect(activeEffects.textPulses.get("root.0")).toEqual([
        expect.objectContaining({ offset: 4 }),
      ]);
      expect(activeEffects.textHighlights.get("root.0")).toBeUndefined();
    });

    test("does not keep color emoji insertion active by default", () => {
      const effects = [insertedText("🔥")];
      const activeEffects = resolveActiveEffects(effects, now);

      expect(activeEffects.textHighlights.size).toBe(0);
      expect(activeEffects.activeEditorEffects).toEqual([]);
    });
  });

  describe("text deletion", () => {
    test("maps plain backward line-end deletion to a fade", () => {
      const activeEffects = resolveActiveEffects([deletedText()], now);

      expect(activeEffects.textFades.get("root.0")).toEqual([
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

      const activeEffects = resolveActiveEffects(effects, now);

      expect(activeEffects.textFades.size).toBe(0);
      expect(activeEffects.activeEditorEffects).toEqual([]);
    });
  });

  test("keeps only effects accepted by the default policy active", () => {
    const running = insertedText("x");
    const skipped = insertedText("🔥");

    expect(resolveActiveEffects([running, skipped], now).activeEditorEffects).toEqual([running]);
  });

  describe("custom duration policy", () => {
    test("can disable default handling for an effect", () => {
      const effect = insertedText("x");
      const policy = withDurationOverride((currentEffect) =>
        currentEffect.kind === "text-inserted"
          ? null
          : defaultEffectPolicy.duration(currentEffect),
      );

      const activeEffects = resolveActiveEffects([effect], now, policy);

      expect(activeEffects.textHighlights.size).toBe(0);
      expect(activeEffects.activeEditorEffects).toEqual([]);
    });

    test("can extend the running lifetime for an effect", () => {
      const effect = insertedText("x");
      const afterDefaultExpiration = startedAt + 1200;
      const policy = withDurationOverride((currentEffect) =>
        currentEffect.kind === "text-inserted"
          ? 1500
          : defaultEffectPolicy.duration(currentEffect),
      );

      expect(resolveActiveEffects([effect], afterDefaultExpiration).activeEditorEffects).toEqual(
        [],
      );
      expect(
        resolveActiveEffects([effect], afterDefaultExpiration, policy).activeEditorEffects,
      ).toEqual([effect]);
      expect(
        resolveActiveEffects([effect], afterDefaultExpiration, policy).textHighlights.size,
      ).toBe(1);
    });

    test("can opt into default visual mapping for effects the default policy skips", () => {
      const effect = insertedText("🔥");
      const policy = withDurationOverride((currentEffect) =>
        currentEffect.kind === "text-inserted"
          ? 1000
          : defaultEffectPolicy.duration(currentEffect),
      );

      expect(resolveActiveEffects([effect], now).textHighlights.size).toBe(0);
      expect(resolveActiveEffects([effect], now, policy).textHighlights.size).toBe(1);
    });
  });

  describe("custom effect handlers", () => {
    test("keep matching semantic effects active when the default policy skips them", () => {
      const insertedEmoji = insertedText("🔥");
      const forwardDelete = deletedText({ direction: "forward", placement: "line-middle" });

      expect(resolveActiveEffects([insertedEmoji, forwardDelete], now).activeEditorEffects).toEqual(
        [],
      );
      expect(
        resolveActiveEffects(
          [insertedEmoji, forwardDelete],
          now,
          defaultEffectPolicy,
          {
            textDeleted: () => {},
            textInserted: () => {},
          },
        ).activeEditorEffects,
      ).toEqual([insertedEmoji, forwardDelete]);
    });
  });
});

function withDurationOverride(duration: EffectPolicy["duration"]): EffectPolicy {
  return { duration };
}

function insertedText(text: string): ActiveEditorEffect {
  return {
    kind: "text-inserted",
    text,
    regionPath: "root.0",
    startOffset: 4,
    endOffset: 4 + text.length,
    startedAt,
  };
}

function deletedText(
  overrides: Partial<Extract<ActiveEditorEffect, { kind: "text-deleted" }>> = {},
): ActiveEditorEffect {
  return {
    kind: "text-deleted",
    text: "a",
    regionPath: "root.0",
    startOffset: 3,
    direction: "backward",
    placement: "line-end",
    textKind: "plain",
    startedAt,
    ...overrides,
  };
}
