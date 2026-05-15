import { useEffect, useEffectEvent, useRef, useState } from "react";

const activityIdleDelayMs = 600;

export type IdleState = {
  activeAt: number | null;
  resolveAnimationTime: (now?: number) => number;
  isActive: () => boolean;
  markActive: () => void;
};

type UseIdleOptions = {
  onIdle?: () => void;
};

export function useIdle({ onIdle }: UseIdleOptions = {}): IdleState {
  const [activeAt, setActiveAt] = useState<number | null>(null);
  const activeAtRef = useRef<number | null>(null);
  const animationOriginRef = useRef(performance.now());
  const idleTimerRef = useRef<number | null>(null);

  const clearIdleTimer = () => {
    if (typeof window === "undefined" || idleTimerRef.current === null) {
      return;
    }

    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  };

  const markIdle = useEffectEvent(() => {
    const activeAt = activeAtRef.current;

    if (activeAt !== null) {
      animationOriginRef.current = performance.now() - (activeAt - animationOriginRef.current);
    }

    idleTimerRef.current = null;
    activeAtRef.current = null;
    setActiveAt(null);
    onIdle?.();
  });

  const markActive = useEffectEvent(() => {
    const now = performance.now();

    if (activeAtRef.current === null) {
      activeAtRef.current = now;
      setActiveAt(now);
    }

    clearIdleTimer();

    if (typeof window !== "undefined") {
      idleTimerRef.current = window.setTimeout(markIdle, activityIdleDelayMs);
    }
  });

  const isActive = useEffectEvent(() => activeAtRef.current !== null);
  const resolveAnimationTime = useEffectEvent(
    (now = performance.now()) => (activeAtRef.current ?? now) - animationOriginRef.current,
  );

  useEffect(() => clearIdleTimer, []);

  return {
    activeAt,
    resolveAnimationTime,
    isActive,
    markActive,
  };
}
