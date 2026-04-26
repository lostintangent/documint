// Portal for overlay UI (leaves, completion popovers — anything that needs
// to render above and outside the editor surface). Renders into
// document.body so the overlay escapes any host-app CSS interference
// (overflow clipping, transformed ancestors, stacking contexts) that would
// otherwise trap content rendered inside the React tree.
//
// Documint's theme is exposed as inline CSS custom properties on a wrapper
// around the portaled content, so the editor's visual identity travels
// with the overlay even though it no longer descends from the host element.
// That detail is internal — consumers just wrap UI in <OverlayPortal>.
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

const OverlayThemeContext = createContext<CSSProperties | undefined>(undefined);

export function OverlayPortalProvider({
  children,
  themeStyles,
}: {
  children: ReactNode;
  themeStyles: CSSProperties;
}) {
  return (
    <OverlayThemeContext.Provider value={themeStyles}>{children}</OverlayThemeContext.Provider>
  );
}

export function OverlayPortal({ children }: { children: ReactNode }) {
  const themeStyles = useContext(OverlayThemeContext);

  if (typeof document === "undefined") {
    return null;
  }

  // The wrapper exists only to carry theme custom properties to portaled
  // descendants. `display: contents` keeps it transparent to layout so the
  // overlay's own positioning (typically position: fixed) is unaffected.
  return createPortal(
    <div className="documint-overlay" style={{ display: "contents", ...themeStyles }}>
      {children}
    </div>,
    document.body,
  );
}
