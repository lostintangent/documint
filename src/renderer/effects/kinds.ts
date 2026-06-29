import type { TextDeletedEffect, TextInsertedEffect } from "@/editor/state";
import { containsColorEmoji } from "@/editor/text/emoji";
import type { DocumintEffects } from "@/types";
import type {
  BlockFlashFrame,
  BlockPulseFrame,
  RendererEffect,
  TextFadeFrame,
  TextHighlightFrame,
  TextPulseFrame,
  DocumentChangeFadeFrame,
} from "./types";

export type EffectGroups = {
  blockFlashes: Map<string, BlockFlashFrame>;
  blockPulses: Map<string, BlockPulseFrame>;
  documentChangeFades: Map<string, DocumentChangeFadeFrame>;
  textFades: Map<string, TextFadeFrame[]>;
  textHighlights: Map<string, TextHighlightFrame[]>;
  textPulses: Map<string, TextPulseFrame[]>;
};

type EffectOfKind<TKind extends RendererEffect["kind"]> = Extract<RendererEffect, { kind: TKind }>;

type EffectKindDescriptor<TKind extends RendererEffect["kind"]> = {
  animatesByDefault: (effect: EffectOfKind<TKind>) => boolean;
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
    animatesByDefault: () => true,
    collect: (groups, effect, progress, defaultEnabled) => {
      groups.blockFlashes.set(effect.blockPath, {
        blockPath: effect.blockPath,
        customEffectName: "activeBlockChanged",
        defaultEnabled,
        progress,
      });
    },
    customHandlerKey: "activeBlockChanged",
    duration: () => activeBlockChangedDurationMs,
  },
  "document-change": {
    animatesByDefault: () => true,
    collect: (groups, effect, progress) => {
      groups.documentChangeFades.set(effect.changeKey, {
        progress,
      });
    },
    customHandlerKey: null,
    duration: () => documentChangeFadeDurationMs,
  },
  "list-item-inserted": {
    animatesByDefault: () => true,
    collect: (groups, effect, progress, defaultEnabled) => {
      groups.blockPulses.set(effect.blockPath, {
        blockPath: effect.blockPath,
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
      collectMany(groups.textFades, effect.regionPath, {
        contentKind: resolveTextEffectContentKind(effect),
        customEffectName: "textDeleted",
        defaultEnabled,
        progress,
        regionPath: effect.regionPath,
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
      if (isPunctuationInsertion(effect)) {
        collectMany(groups.textPulses, effect.regionPath, {
          contentKind: resolveTextEffectContentKind(effect),
          customEffectName: "textInserted",
          defaultEnabled,
          endOffset: effect.endOffset,
          progress,
          regionPath: effect.regionPath,
          startOffset: effect.startOffset,
          text: effect.text,
        });
        return;
      }

      collectMany(groups.textHighlights, effect.regionPath, {
        contentKind: resolveTextEffectContentKind(effect),
        customEffectName: "textInserted",
        defaultEnabled,
        endOffset: effect.endOffset,
        progress,
        regionPath: effect.regionPath,
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

function collectMany<TEffect>(
  result: Map<string, TEffect[]>,
  key: string,
  item: TEffect,
) {
  const existing = result.get(key);

  if (existing) {
    existing.push(item);
  } else {
    result.set(key, [item]);
  }
}

function shouldAnimateTextDeletedEffect(effect: TextDeletedEffect) {
  return (
    effect.regionKind === "inlines" &&
    effect.direction === "backward" &&
    effect.textKind === "plain" &&
    effect.placement !== "line-middle" &&
    !containsColorEmoji(effect.text)
  );
}

function shouldAnimateTextInsertedEffect(effect: TextInsertedEffect) {
  return effect.regionKind === "inlines" && !containsColorEmoji(effect.text);
}

function isPunctuationInsertion(effect: TextInsertedEffect) {
  return effect.text === ".";
}

function resolveTextEffectContentKind(effect: TextDeletedEffect | TextInsertedEffect): "code" | "text" {
  return effect.regionKind === "source" ? "code" : "text";
}
