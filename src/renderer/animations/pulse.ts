const restingPulseCycleMs = 2200;

export const restingPulseMinimumAlpha = 0.42;

export function resolveRestingPulseProgress(time: number) {
  const progress = (Math.max(0, time) % restingPulseCycleMs) / restingPulseCycleMs;

  return (1 + Math.cos(progress * Math.PI * 2)) / 2;
}

export function resolveRestingPulseAlpha(time: number, minimumAlpha: number) {
  const progress = resolveRestingPulseProgress(time);

  return minimumAlpha + (1 - minimumAlpha) * progress;
}

export function paintAmbientlyPulsing(
  context: CanvasRenderingContext2D,
  time: number,
  paint: () => void,
  minimumAlpha: number = restingPulseMinimumAlpha,
) {
  context.save();
  context.globalAlpha *= resolveRestingPulseAlpha(time, minimumAlpha);
  paint();
  context.restore();
}
