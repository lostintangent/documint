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
  useLayoutEffect,
  useState,
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
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null);

  useLayoutEffect(() => {
    const host = document.createElement("div");
    host.dataset.documintOverlayRoot = "";
    host.style.position = "absolute";
    host.style.top = "0";
    host.style.left = "0";
    host.style.width = "0";
    host.style.height = "0";
    host.style.overflow = "visible";
    host.style.zIndex = "2147483647";

    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = overlayCss;
    root.append(style);

    document.body.append(host);
    setShadowRoot(root);

    return () => {
      setShadowRoot(null);
      host.remove();
    };
  }, []);

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
    <div className="overlay" style={{ display: "contents", ...context.themeStyles }}>
      {children}
    </div>,
    context.shadowRoot,
  );
}
