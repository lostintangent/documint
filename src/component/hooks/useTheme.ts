import { useMemo, type CSSProperties } from "react";
import type { EditorTheme, ResolvedEditorTheme } from "@/renderer";
import { darkTheme, lightTheme, resolveEditorTheme } from "../lib/themes";
import { useMediaQuery } from "./useMediaQuery";

export function useTheme(theme?: EditorTheme) {
  // The system color scheme only matters when the host omits `theme`.
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)", theme === undefined);
  const resolvedTheme = useMemo(
    () => resolveEditorTheme(theme ?? (prefersDark ? darkTheme : lightTheme)),
    [prefersDark, theme],
  );
  const themeStyles = createThemeStyles(resolvedTheme);

  return {
    theme: resolvedTheme,
    themeStyles,
  };
}

function createThemeStyles(theme: ResolvedEditorTheme): CSSProperties {
  return {
    "--documint-background": theme.background,
    "--documint-inline-code-bg": theme.inlineCodeBackground,
    "--documint-inline-code-text": theme.inlineCodeText,
    "--documint-leaf-button-text": theme.leafButtonText,
    "--documint-leaf-accent": theme.leafAccent,
    "--documint-leaf-bg": theme.leafBackground,
    "--documint-leaf-border": theme.leafBorder,
    "--documint-leaf-input-bg": theme.leafInputBackground,
    "--documint-leaf-font-family": '"Avenir Next", "Segoe UI", sans-serif',
    "--documint-leaf-shadow": theme.leafShadow,
    "--documint-leaf-secondary-text": theme.leafSecondaryText,
    "--documint-leaf-text": theme.leafText,
    "--documint-mention-bg": theme.mentionBackground,
    "--documint-mention-text": theme.mentionText,
    "--documint-selection-handle-bg": theme.selectionHandleBackground,
    "--documint-selection-handle-border": theme.selectionHandleBorder,
    "--documint-scrollbar": theme.scrollbar,
  } as CSSProperties;
}
