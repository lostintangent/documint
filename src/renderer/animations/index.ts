// Owns paint-time animation helpers. The editor model stores transient effect
// descriptors (in `state/animations`); this module turns those descriptors
// into render-local data (per-frame `progress`) and the color blends the
// main paint orchestrator applies while drawing text. The duration table and
// `hasRunningEditorAnimations` predicate live in `state/animations` because
// they are model-lifetime policy, not paint policy.

import type { ResolvedEditorTheme } from "@/types";
import {
  getEditorAnimationDuration,
  type ActiveBlockFlashAnimation,
  type TextFadeAnimation,
  type EditorState,
  type EditorAnimation,
  type TextHighlightAnimation,
  type BlockPulseAnimation,
  type TextPulseAnimation,
} from "@/editor/state";
import { blendCanvasColors, transparentCanvasColor } from "./colors";

export type ActiveBlockFlash = ActiveBlockFlashAnimation & {
  progress: number;
};

export type ActiveTextFade = TextFadeAnimation & {
  progress: number;
};

export type ActiveTextHighlight = TextHighlightAnimation & {
  progress: number;
};

export type ActiveBlockPulse = BlockPulseAnimation & {
  progress: number;
};

export type ActiveTextPulse = TextPulseAnimation & {
  progress: number;
};

export type ActiveAnimations = {
  activeBlockFlashes: Map<string, ActiveBlockFlash>;
  activeBlockPulses: Map<string, ActiveBlockPulse>;
  activeTextFades: Map<string, ActiveTextFade[]>;
  activeTextHighlights: Map<string, ActiveTextHighlight[]>;
  activeTextPulses: Map<string, ActiveTextPulse[]>;
};

// List marker pop reaches full scale in the first half of its duration,
// then blends color back to the base in the second half.
const LIST_MARKER_POP_MIN_SCALE = 0.1;
const LIST_MARKER_POP_SCALE_RANGE = 0.9;
const LIST_MARKER_POP_SCALE_SPEED = 2;
const LIST_MARKER_POP_COLOR_SPEED = 2;

type ActiveEditorAnimation = EditorAnimation & { progress: number };

type AnimationSpec = {
  collect: (result: ActiveAnimations, animation: ActiveEditorAnimation) => void;
  kind: EditorAnimation["kind"];
  // Documents whether a row keeps one latest animation per key or many. The
  // `collect` closure implements the policy so each row stays self-contained.
  multiplicity: "many" | "one";
};

const animationSpecs: readonly AnimationSpec[] = [
  {
    collect: (result, animation) => {
      const active = animation as ActiveBlockFlash;
      result.activeBlockFlashes.set(active.blockPath, active);
    },
    kind: "active-block-flash",
    multiplicity: "one",
  },
  {
    collect: (result, animation) => {
      const active = animation as ActiveBlockPulse;
      result.activeBlockPulses.set(active.blockPath, active);
    },
    kind: "block-pulse",
    multiplicity: "one",
  },
  {
    collect: (result, animation) => {
      const active = animation as ActiveTextFade;
      collectMany(result.activeTextFades, active.regionPath, active);
    },
    kind: "text-fade",
    multiplicity: "many",
  },
  {
    collect: (result, animation) => {
      const active = animation as ActiveTextHighlight;
      collectMany(result.activeTextHighlights, active.regionPath, active);
    },
    kind: "text-highlight",
    multiplicity: "many",
  },
  {
    collect: (result, animation) => {
      const active = animation as ActiveTextPulse;
      collectMany(result.activeTextPulses, active.regionPath, active);
    },
    kind: "text-pulse",
    multiplicity: "many",
  },
];

const animationSpecByKind = new Map(animationSpecs.map((spec) => [spec.kind, spec]));

export function resolveActiveAnimations(state: EditorState, now: number): ActiveAnimations {
  const result = createEmptyActiveAnimations();

  for (const animation of state.animations) {
    const spec = animationSpecByKind.get(animation.kind);

    if (!spec) {
      continue;
    }

    const progress = resolveAnimationProgress(animation, now);

    if (progress === null) {
      continue;
    }

    spec.collect(result, { ...animation, progress });
  }

  return result;
}

export function resolveTextFadeColor(baseColor: string, textFade: ActiveTextFade) {
  return blendCanvasColors(baseColor, transparentCanvasColor, textFade.progress);
}

export function resolveActiveBlockFlashColor(
  activeBlockFlashColor: string,
  activeBlockFlash: ActiveBlockFlash,
) {
  return blendCanvasColors(
    activeBlockFlashColor,
    transparentCanvasColor,
    activeBlockFlash.progress,
  );
}

export function resolveTextPulseColor(textPulse: ActiveTextPulse, theme: ResolvedEditorTheme) {
  return blendCanvasColors(theme.insertHighlightText, transparentCanvasColor, textPulse.progress);
}

export function resolveBlockPulseScale(pop: ActiveBlockPulse) {
  const scaleProgress = Math.min(1, pop.progress * LIST_MARKER_POP_SCALE_SPEED);
  return LIST_MARKER_POP_MIN_SCALE + LIST_MARKER_POP_SCALE_RANGE * easeOutCubic(scaleProgress);
}

export function resolveBlockPulseColor(
  baseColor: string,
  pop: ActiveBlockPulse,
  theme: ResolvedEditorTheme,
) {
  const colorProgress = Math.max(0, pop.progress * LIST_MARKER_POP_COLOR_SPEED - 1);
  return blendCanvasColors(theme.insertHighlightText, baseColor, colorProgress);
}

function createEmptyActiveAnimations(): ActiveAnimations {
  return {
    activeBlockFlashes: new Map(),
    activeBlockPulses: new Map(),
    activeTextFades: new Map(),
    activeTextHighlights: new Map(),
    activeTextPulses: new Map(),
  };
}

function collectMany<TAnimation>(
  result: Map<string, TAnimation[]>,
  key: string,
  animation: TAnimation,
) {
  const existing = result.get(key);

  if (existing) {
    existing.push(animation);
  } else {
    result.set(key, [animation]);
  }
}

function resolveAnimationProgress(animation: EditorAnimation, now: number): number | null {
  const durationMs = getEditorAnimationDuration(animation);
  const elapsed = now - animation.startedAt;

  if (elapsed >= durationMs) {
    return null;
  }

  return Math.max(0, Math.min(1, elapsed / durationMs));
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}
