import { useEffect, useEffectEvent, useRef, useState } from "react";

const ACTIVITY_IDLE_DELAY_MS = 600;

export type IdleState = {
  activeAt: number | null;
  resolveAnimationTime: (now?: number) => number;
  isActive: () => boolean;
  markActive: () => void;
};

export function useIdle(): IdleState {
  /* Activity state */

  const [activeAt, setActiveAt] = useState<number | null>(null);
  const activeAtRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);

  const clearIdleTimer = () => {
    if (idleTimerRef.current === null) {
      return;
    }

    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  };

  /* Animation clock */

  const [initialOriginAt] = useState(() => performance.now());
  const animationOriginRef = useRef(initialOriginAt);

  const resolveAnimationTime = useEffectEvent(
    (now = performance.now()) => (activeAtRef.current ?? now) - animationOriginRef.current,
  );

  /* Activity transitions */

  const markIdle = useEffectEvent(() => {
    const activeAt = activeAtRef.current;

    if (activeAt !== null) {
      animationOriginRef.current = performance.now() - (activeAt - animationOriginRef.current);
    }

    idleTimerRef.current = null;
    activeAtRef.current = null;
    setActiveAt(null);
  });

  const markActive = useEffectEvent(() => {
    const now = performance.now();

    if (activeAtRef.current === null) {
      activeAtRef.current = now;
      setActiveAt(now);
    }

    clearIdleTimer();

    idleTimerRef.current = window.setTimeout(markIdle, ACTIVITY_IDLE_DELAY_MS);
  });

  const isActive = useEffectEvent(() => activeAtRef.current !== null);

  /* Lifecycle */

  useEffect(() => clearIdleTimer, []);

  /* Public API */

  return {
    activeAt,
    resolveAnimationTime,
    isActive,
    markActive,
  };
}
