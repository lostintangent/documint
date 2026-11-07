import type { TextDeletedEffect, TextInsertedEffect } from "@/editor/state";
import type {
  BlockFlashFrame,
  BlockPulseFrame,
  RendererEffect,
  TextFadeFrame,
  TextInsertionFrame,
  DocumentChangeFadeFrame,
  DocumintEffects,
} from "./types";

export type EffectGroups = {
  blockFlashes: Map<string, BlockFlashFrame>;
  blockPulses: Map<string, BlockPulseFrame>;
  documentChangeFades: Map<string, DocumentChangeFadeFrame>;
  textFades: Map<string, TextFadeFrame[]>;
  textHighlights: Map<string, TextInsertionFrame[]>;
  textPulses: Map<string, TextInsertionFrame[]>;
};

type EffectOfKind<TKind extends RendererEffect["kind"]> = Extract<RendererEffect, { kind: TKind }>;

type EffectKindDescriptor<TKind extends RendererEffect["kind"]> = {
  // Omitted when every effect of the kind animates by default.
  animatesByDefault?: (effect: EffectOfKind<TKind>) => boolean;
  collect: (
    groups: EffectGroups,
    effect: EffectOfKind<TKind>,
    progress: number,
    defaultEnabled: boolean,
  ) => void;
  customHandlerKey: keyof DocumintEffects | null;
  duration: (effect: EffectOfKind<TKind>) => number;
};

const activeBlockChangedDurationMs = 300;
const documentChangeFadeDurationMs = 420;
const textDeletedDurationMs = 180;
const textInsertedDurationMs = 1000;
const listItemInsertedDurationMs = 500;
const punctuationInsertedDurationMs = 140;

export const effectKinds: {
  [TKind in RendererEffect["kind"]]: EffectKindDescriptor<TKind>;
} = {
  "active-block-changed": {
    collect: (groups, effect, progress, defaultEnabled) => {
      groups.blockFlashes.set(effect.blockPath, {
        customEffectName: "activeBlockChanged",
        defaultEnabled,
        progress,
      });
    },
    customHandlerKey: "activeBlockChanged",
    duration: () => activeBlockChangedDurationMs,
  },
  "document-change": {
    collect: (groups, effect, progress) => {
      groups.documentChangeFades.set(effect.changeKey, {
        progress,
      });
    },
    customHandlerKey: null,
    duration: () => documentChangeFadeDurationMs,
  },
  "list-item-inserted": {
    collect: (groups, effect, progress, defaultEnabled) => {
      groups.blockPulses.set(effect.blockPath, {
        customEffectName: "listItemInserted",
        defaultEnabled,
        progress,
      });
    },
    customHandlerKey: "listItemInserted",
    duration: () => listItemInsertedDurationMs,
  },
  "text-deleted": {
    animatesByDefault: shouldAnimateTextDeletedEffect,
    collect: (groups, effect, progress, defaultEnabled) => {
      collectMany(groups.textFades, effect.path, {
        contentKind: resolveTextEffectContentKind(effect),
        customEffectName: "textDeleted",
        defaultEnabled,
        progress,
        startOffset: effect.startOffset,
        text: effect.text,
      });
    },
    customHandlerKey: "textDeleted",
    duration: () => textDeletedDurationMs,
  },
  "text-inserted": {
    animatesByDefault: shouldAnimateTextInsertedEffect,
    collect: (groups, effect, progress, defaultEnabled) => {
      const group = isPunctuationInsertion(effect) ? groups.textPulses : groups.textHighlights;

      collectMany(group, effect.path, {
        contentKind: resolveTextEffectContentKind(effect),
        customEffectName: "textInserted",
        defaultEnabled,
        endOffset: effect.endOffset,
        progress,
        startOffset: effect.startOffset,
        text: effect.text,
      });
    },
    customHandlerKey: "textInserted",
    duration: (effect) =>
      isPunctuationInsertion(effect) ? punctuationInsertedDurationMs : textInsertedDurationMs,
  },
};

export function descriptorFor<TEffect extends RendererEffect>(effect: TEffect) {
  return effectKinds[effect.kind] as EffectKindDescriptor<TEffect["kind"]>;
}

export function collectMany<TEffect>(result: Map<string, TEffect[]>, key: string, item: TEffect) {
  const existing = result.get(key);

  if (existing) {
    existing.push(item);
  } else {
    result.set(key, [item]);
  }
}

function shouldAnimateTextDeletedEffect(effect: TextDeletedEffect) {
  return (
    effect.contentKind !== "source" &&
    effect.direction === "backward" &&
    effect.textKind === "plain" &&
    effect.placement !== "line-middle" &&
    !containsColorEmoji(effect.text)
  );
}

function shouldAnimateTextInsertedEffect(effect: TextInsertedEffect) {
  return effect.contentKind !== "source" && !containsColorEmoji(effect.text);
}

function containsColorEmoji(text: string) {
  return colorEmojiPattern.test(text);
}

const colorEmojiPattern = /[\uFE0F\u{1F1E6}-\u{1F1FF}\p{Extended_Pictographic}]/u;

function isPunctuationInsertion(effect: TextInsertedEffect) {
  return effect.text === ".";
}

function resolveTextEffectContentKind(
  effect: TextDeletedEffect | TextInsertedEffect,
): "code" | "text" {
  return effect.contentKind === "source" ? "code" : "text";
}
