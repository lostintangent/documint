import { useEffect, useState } from "react";
import { darkTheme, lightTheme, type EditorTheme } from "documint";

type ColorMode = "dark" | "light";

type GitHubDocumintTheme = {
  accent: string;
  background: string;
  colorMode: ColorMode;
  text: string;
  theme: EditorTheme;
};

const githubThemeFallbacks = {
  dark: { accent: "#4493f8", background: "#0d1117", text: "#f0f6fc" },
  light: { accent: "#0969da", background: "#ffffff", text: "#1f2328" },
};
const accentColorVariables = [
  "--fgColor-accent",
  "--color-accent-fg",
  "--color-accent-emphasis",
];
const backgroundColorVariables = [
  "--bgColor-default",
  "--color-canvas-default",
  "--background",
  "--color-bg-default",
  "--canvas-background",
];
const textColorVariables = [
  "--fgColor-default",
  "--color-fg-default",
  "--foreground",
  "--textColor-default",
  "--color-text-primary",
];

export function useTheme(): EditorTheme {
  const [themeState, setThemeState] = useState(createGitHubDocumintTheme);

  useEffect(() => {
    let frameId: number | null = null;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      frameId = null;
      setThemeState((previousThemeState) => {
        const nextThemeState = createGitHubDocumintTheme(media);

        return areThemeStatesEqual(previousThemeState, nextThemeState)
          ? previousThemeState
          : nextThemeState;
      });
    };
    const scheduleThemeUpdate = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(applyTheme);
    };
    const observer = new MutationObserver(scheduleThemeUpdate);

    observer.observe(document.documentElement, {
      attributeFilter: ["class", "data-color-mode", "data-theme", "style"],
      attributes: true,
    });
    if (document.body) {
      observer.observe(document.body, {
        attributeFilter: ["class", "data-color-mode", "data-theme", "style"],
        attributes: true,
      });
    }
    media.addEventListener("change", scheduleThemeUpdate);
    scheduleThemeUpdate();

    return () => {
      media.removeEventListener("change", scheduleThemeUpdate);
      observer.disconnect();

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--documint-agent-accent", themeState.accent);
    document.documentElement.style.setProperty("--documint-agent-background", themeState.background);
    document.documentElement.style.setProperty("--documint-agent-text", themeState.text);
    document.documentElement.style.colorScheme = themeState.colorMode;
  }, [themeState]);

  return themeState.theme;
}

function createGitHubDocumintTheme(media = window.matchMedia("(prefers-color-scheme: dark)")): GitHubDocumintTheme {
  const colorMode = resolveAppColorMode(media);
  const colors = resolveGitHubAppColors(colorMode);
  const baseTheme = colorMode === "dark" ? darkTheme : lightTheme;

  return {
    accent: colors.accent,
    background: colors.background,
    colorMode,
    text: colors.text,
    theme: {
      ...baseTheme,
      accent: colors.accent,
      background: colors.background,
      text: colors.text,
      commentHighlightActive:
        colorMode === "dark" ? "rgba(139, 92, 246, 0.30)" : "rgba(124, 58, 237, 0.24)",
      mentionBackground:
        colorMode === "dark" ? "rgba(139, 92, 246, 0.16)" : "rgba(124, 58, 237, 0.12)",
      mentionText: colorMode === "dark" ? "#ddd6fe" : "#5b21b6",
    },
  };
}

function resolveAppColorMode(media: MediaQueryList): ColorMode {
  const root = document.documentElement;
  const body = document.body;
  const declaredTheme = [
    root.dataset.colorMode,
    root.dataset.theme,
    root.className,
    body?.dataset.colorMode,
    body?.dataset.theme,
    body?.className,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(dark|dimmed)\b/.test(declaredTheme)) {
    return "dark";
  }
  if (/\blight\b/.test(declaredTheme)) {
    return "light";
  }

  const colorScheme = `${getComputedStyle(root).colorScheme} ${
    body ? getComputedStyle(body).colorScheme : ""
  }`.toLowerCase();
  if (colorScheme.includes("dark") && !colorScheme.includes("light")) {
    return "dark";
  }
  if (colorScheme.includes("light") && !colorScheme.includes("dark")) {
    return "light";
  }

  return media.matches ? "dark" : "light";
}

function resolveGitHubAppColors(
  colorMode: ColorMode,
): { accent: string; background: string; text: string } {
  const styles = getComputedStyle(document.documentElement);
  const fallback = githubThemeFallbacks[colorMode];
  return {
    accent: readCssColor(styles, accentColorVariables) ?? fallback.accent,
    background: readCssColor(styles, backgroundColorVariables) ?? fallback.background,
    text: readCssColor(styles, textColorVariables) ?? fallback.text,
  };
}

function readCssColor(styles: CSSStyleDeclaration, names: readonly string[]): string | null {
  for (const name of names) {
    const color = normalizeCssColor(styles.getPropertyValue(name));
    if (color) {
      return color;
    }
  }
  return null;
}

function normalizeCssColor(value: string): string | null {
  const color = value.trim();
  if (!color) {
    return null;
  }
  if (CSS.supports("color", color)) {
    return color;
  }

  const hslColor = `hsl(${color})`;
  return CSS.supports("color", hslColor) ? hslColor : null;
}

function areThemeStatesEqual(left: GitHubDocumintTheme, right: GitHubDocumintTheme): boolean {
  return (
    left.background === right.background &&
    left.accent === right.accent &&
    left.colorMode === right.colorMode &&
    left.text === right.text &&
    areThemesEqual(left.theme, right.theme)
  );
}

function areThemesEqual(left: EditorTheme, right: EditorTheme): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => right[key as keyof EditorTheme] === value)
  );
}
