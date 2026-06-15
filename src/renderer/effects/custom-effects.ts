import type {
  DocumintEffectHandler,
  DocumintEffects,
  EffectEnvironment,
} from "@/types";
import type { EffectFrame } from "./types";

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
    const effectContext = { ...environment, ...args } as EffectContextFor<typeof frame.customEffectName>;

    const paintDefaultVisual = () => {
      if (frame.defaultEnabled) {
        paintWithSavedState(environment.context, () => paintDefault(effectContext));
      }
    };

    if (!handler) {
      paintDefaultVisual();
      return;
    }

    const { compose, paint } = resolveEffectHandler(handler);

    if (compose === "before") {
      paintWithSavedState(environment.context, () => paint(effectContext));
      paintDefaultVisual();
      return;
    }

    if (compose === "after") {
      paintDefaultVisual();
      paintWithSavedState(environment.context, () => paint(effectContext));
      return;
    }

    paintWithSavedState(environment.context, () => paint(effectContext));
  };
}

function resolveEffectHandler<TContext>(handler: DocumintEffectHandler<TContext>): {
  compose: "after" | "before" | "replace";
  paint: (context: TContext) => void;
} {
  if (typeof handler === "function") {
    return { compose: "replace", paint: handler };
  }

  return { compose: handler.compose ?? "replace", paint: handler.paint };
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
