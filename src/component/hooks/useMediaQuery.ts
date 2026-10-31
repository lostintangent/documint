import { useSyncExternalStore } from "react";

// Follows a CSS media query. A disabled query reports false without
// subscribing, so callers can skip queries they only sometimes need. Hosts
// without `matchMedia`, such as jsdom, read every query as false.
export function useMediaQuery(query: string, enabled = true): boolean {
  const subscribe = (onChange: () => void) => {
    const media = enabled ? matchMediaQuery(query) : null;
    if (!media) {
      return () => {};
    }

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  };

  return useSyncExternalStore(
    subscribe,
    () => enabled && (matchMediaQuery(query)?.matches ?? false),
    () => false,
  );
}

function matchMediaQuery(query: string): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
}
