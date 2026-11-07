import type {
  EffectFrame,
  DocumintEffectHandler,
  DocumintEffects,
  EffectEnvironment,
} from "./types";

type EffectArgs<TKind extends keyof DocumintEffects> = Omit<
  EffectContextFor<TKind>,
  keyof EffectEnvironment
>;

export type PaintEffect = <TKind extends keyof DocumintEffects>(
  frame: EffectFrame<TKind>,
  args: EffectArgs<TKind>,
  paintDefault: (context: EffectContextFor<TKind>) => void,
) => void;

export function createPaintEffect(
  environment: EffectEnvironment,
  effects?: DocumintEffects,
): PaintEffect {
  return (frame, args, paintDefault) => {
    const handler = effects?.[frame.customEffectName] as
      | DocumintEffectHandler<EffectContextFor<typeof frame.customEffectName>>
      | undefined;
    const effectContext = { ...environment, ...args } as EffectContextFor<
      typeof frame.customEffectName
    >;
    // A bare function handler replaces the default visual.
    const { compose = "replace", paint } =
      typeof handler === "function" ? { paint: handler } : (handler ?? {});

    if (paint && compose === "before") {
      paintWithSavedState(environment.context, () => paint(effectContext));
    }

    if (frame.defaultEnabled && (!paint || compose !== "replace")) {
      paintWithSavedState(environment.context, () => paintDefault(effectContext));
    }

    if (paint && compose !== "before") {
      paintWithSavedState(environment.context, () => paint(effectContext));
    }
  };
}

function paintWithSavedState(context: CanvasRenderingContext2D, paint: () => void) {
  context.save();
  paint();
  context.restore();
}

type EffectContextFor<TKind extends keyof DocumintEffects> =
  NonNullable<DocumintEffects[TKind]> extends DocumintEffectHandler<infer TContext>
    ? TContext
    : never;
