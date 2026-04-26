import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { EditorTheme } from "@/types";
import type { DocumintTheme } from "../Documint";
import { darkTheme, lightTheme } from "../lib/themes";

type DocumintThemePair = {
  dark: EditorTheme;
  light: EditorTheme;
};

export function useTheme(theme: DocumintTheme | undefined) {
  const themePair = useMemo(() => resolveThemePair(theme), [theme]);
  const [preferredTheme, setPreferredTheme] = useState<EditorTheme>(themePair.light);
  const themeStyles = useMemo(() => createThemeStyles(preferredTheme), [preferredTheme]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setPreferredTheme(themePair.light);
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => {
      setPreferredTheme(mediaQuery.matches ? themePair.dark : themePair.light);
    };

    updateTheme();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateTheme);

      return () => {
        mediaQuery.removeEventListener("change", updateTheme);
      };
    }

    mediaQuery.addListener(updateTheme);

    return () => {
      mediaQuery.removeListener(updateTheme);
    };
  }, [themePair]);

  return {
    theme: preferredTheme,
    themeStyles,
  };
}

function isThemePair(theme: DocumintTheme): theme is DocumintThemePair {
  return "light" in theme && "dark" in theme;
}

function resolveThemePair(theme: DocumintTheme | undefined): DocumintThemePair {
  if (!theme) {
    return {
      dark: darkTheme,
      light: lightTheme,
    };
  }

  if (isThemePair(theme)) {
    return theme;
  }

  return {
    dark: theme,
    light: theme,
  };
}

function createThemeStyles(theme: EditorTheme): CSSProperties {
  return {
    "--documint-background": theme.background,
    "--documint-leaf-button-bg": theme.leafButtonBackground,
    "--documint-leaf-button-border": theme.leafButtonBorder,
    "--documint-leaf-button-text": theme.leafButtonText,
    "--documint-leaf-accent": theme.leafAccent,
    "--documint-leaf-bg": theme.leafBackground,
    "--documint-leaf-border": theme.leafBorder,
    "--documint-leaf-font-family": '"Avenir Next", "Segoe UI", sans-serif',
    "--documint-leaf-shadow": theme.leafShadow ?? undefined,
    "--documint-leaf-secondary-text": theme.leafSecondaryText,
    "--documint-leaf-resolved-bg": theme.leafResolvedBackground,
    "--documint-leaf-resolved-border": theme.leafResolvedBorder,
    "--documint-leaf-text": theme.leafText,
    "--documint-mention-bg": theme.mentionBackground ?? undefined,
    "--documint-mention-text": theme.mentionText ?? undefined,
    "--documint-selection-handle-bg": theme.selectionHandleBackground,
    "--documint-selection-handle-border": theme.selectionHandleBorder,
  } as CSSProperties;
}
