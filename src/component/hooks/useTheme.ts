import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { EditorTheme, ResolvedEditorTheme } from "@/types";
import type { DocumintTheme } from "../Documint";
import { darkTheme, lightTheme, resolveEditorTheme } from "../lib/themes";

type DocumintThemePair = {
  dark: ResolvedEditorTheme;
  light: ResolvedEditorTheme;
};

type InputDocumintThemePair = {
  dark: EditorTheme;
  light: EditorTheme;
};

export function useTheme(theme: DocumintTheme | undefined) {
  const themePair = useMemo(() => resolveThemePair(theme), [theme]);
  const [preferredTheme, setPreferredTheme] = useState<ResolvedEditorTheme>(() =>
    resolvePreferredTheme(themePair),
  );
  const themeStyles = useMemo(() => createThemeStyles(preferredTheme), [preferredTheme]);

  useEffect(() => {
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

function resolvePreferredTheme(themePair: DocumintThemePair) {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? themePair.dark
    : themePair.light;
}

function isThemePair(theme: DocumintTheme): theme is InputDocumintThemePair {
  return "light" in theme && "dark" in theme;
}

function resolveThemePair(theme: DocumintTheme | undefined): DocumintThemePair {
  if (!theme) {
    return {
      dark: resolveEditorTheme(darkTheme),
      light: resolveEditorTheme(lightTheme),
    };
  }

  if (isThemePair(theme)) {
    return {
      dark: resolveEditorTheme(theme.dark),
      light: resolveEditorTheme(theme.light),
    };
  }

  const resolvedTheme = resolveEditorTheme(theme);

  return {
    dark: resolvedTheme,
    light: resolvedTheme,
  };
}

function createThemeStyles(theme: ResolvedEditorTheme): CSSProperties {
  return {
    "--documint-background": theme.background,
    "--documint-leaf-button-text": theme.leafButtonText,
    "--documint-leaf-accent": theme.leafAccent,
    "--documint-leaf-bg": theme.leafBackground,
    "--documint-leaf-border": theme.leafBorder,
    "--documint-leaf-input-bg": theme.leafInputBackground,
    "--documint-leaf-font-family": '"Avenir Next", "Segoe UI", sans-serif',
    "--documint-leaf-shadow": theme.leafShadow,
    "--documint-leaf-secondary-text": theme.leafSecondaryText,
    "--documint-leaf-resolved-bg": theme.leafResolvedBackground,
    "--documint-leaf-resolved-border": theme.leafResolvedBorder,
    "--documint-leaf-text": theme.leafText,
    "--documint-mention-bg": theme.mentionBackground,
    "--documint-mention-text": theme.mentionText,
    "--documint-selection-handle-bg": theme.selectionHandleBackground,
    "--documint-selection-handle-border": theme.selectionHandleBorder,
  } as CSSProperties;
}
