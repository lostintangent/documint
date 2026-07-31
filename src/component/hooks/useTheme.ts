import { useMemo, useSyncExternalStore, type CSSProperties } from "react";
import type { EditorTheme, ResolvedEditorTheme } from "@/types";
import { darkTheme, lightTheme, resolveEditorTheme } from "../lib/themes";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function useTheme(theme?: EditorTheme) {
  const defaultTheme = useDefaultTheme(theme === undefined);
  const resolvedTheme = useMemo(
    () => resolveEditorTheme(theme ?? defaultTheme),
    [defaultTheme, theme],
  );
  const themeStyles = useMemo(() => createThemeStyles(resolvedTheme), [resolvedTheme]);

  return {
    theme: resolvedTheme,
    themeStyles,
  };
}

function useDefaultTheme(enabled: boolean): EditorTheme {
  const dark = useSyncExternalStore(
    enabled ? subscribeToColorScheme : ignoreColorScheme,
    enabled ? prefersDark : preferLight,
    preferLight,
  );
  return dark ? darkTheme : lightTheme;
}

function subscribeToColorScheme(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function ignoreColorScheme(): () => void {
  return () => {};
}

function prefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

function preferLight(): boolean {
  return false;
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
  } as CSSProperties;
}
