// Portal for overlay UI (leaves, completion popovers — anything that needs
// to render above and outside the editor surface). Renders into a shadow root
// mounted under document.body so the overlay escapes clipping/stacking traps
// while isolating its DOM and utility CSS from the host page.
//
// Documint's theme is exposed as inline CSS custom properties on a wrapper
// around the portaled content, so the editor's visual identity travels
// with the overlay even though it no longer descends from the host element.

import { compileOverlayStyles } from "@macros/overlay-styles" with { type: "macro" };
import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const overlayCss = process.env.NODE_ENV === "test" ? "" : compileOverlayStyles();

type OverlayPortalContextValue = {
  shadowRoot: ShadowRoot | null;
  themeStyles: CSSProperties;
};

const OverlayPortalContext = createContext<OverlayPortalContextValue | null>(null);

export function OverlayPortalProvider({
  children,
  themeStyles,
}: {
  children: ReactNode;
  themeStyles: CSSProperties;
}) {
  const [overlayRoot] = useState(() => createOverlayRootStore(overlayCss));
  const shadowRoot = useSyncExternalStore(
    overlayRoot.subscribe,
    overlayRoot.getShadowRoot,
    () => null,
  );

  return (
    <OverlayPortalContext.Provider value={{ shadowRoot, themeStyles }}>
      {children}
    </OverlayPortalContext.Provider>
  );
}

export function OverlayPortal({ children }: { children: ReactNode }) {
  const context = useContext(OverlayPortalContext);

  if (!context?.shadowRoot) {
    return null;
  }

  return createPortal(
    <div className="overlay" style={context.themeStyles}>
      {children}
    </div>,
    context.shadowRoot,
  );
}

// The overlay host lives outside React's tree, so it is modeled as an external
// store: subscribing mounts the host under document.body, and unsubscribing
// removes it. Creating the store touches no DOM.
function createOverlayRootStore(css: string) {
  let shadowRoot: ShadowRoot | null = null;

  return {
    getShadowRoot: () => shadowRoot,
    subscribe(onChange: () => void) {
      const host = document.createElement("div");
      host.dataset.documintOverlayRoot = "";
      host.style.cssText =
        "position: absolute; top: 0; left: 0; width: 0; height: 0; overflow: visible; z-index: 2147483647";

      const root = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = css;
      root.append(style);

      document.body.append(host);
      shadowRoot = root;
      onChange();

      return () => {
        shadowRoot = null;
        host.remove();
      };
    },
  };
}
