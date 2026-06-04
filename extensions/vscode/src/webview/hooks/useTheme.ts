import { useEffect, useState } from "react";
import { darkTheme, lightTheme, type EditorTheme } from "documint";

export function useTheme(): EditorTheme {
  const [theme, setTheme] = useState(createVsCodeDocumintTheme);

  useEffect(() => {
    let frameId: number | null = null;
    const applyTheme = () => {
      frameId = null;
      setTheme((previousTheme) => {
        const nextTheme = createVsCodeDocumintTheme();

        return areThemesEqual(previousTheme, nextTheme) ? previousTheme : nextTheme;
      });
    };
    const scheduleThemeUpdate = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(applyTheme);
    };
    const observer = new MutationObserver(scheduleThemeUpdate);

    observer.observe(document.body, {
      attributeFilter: ["class", "style"],
      attributes: true,
    });
    observer.observe(document.documentElement, {
      attributeFilter: ["class", "style"],
      attributes: true,
    });

    scheduleThemeUpdate();

    return () => {
      observer.disconnect();

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  return theme;
}

function createVsCodeDocumintTheme(): EditorTheme {
  const isDark = isVsCodeDarkTheme();
  const baseTheme = isDark ? darkTheme : lightTheme;

  const rootStyle = getComputedStyle(document.documentElement);
  const bodyStyle = getComputedStyle(document.body);

  const readColor = (variableName: string, fallback: string) =>
    readVsCodeColor(variableName, fallback, rootStyle, bodyStyle);

  const editorBackground = readColor("--vscode-editor-background", baseTheme.background);
  const editorForeground = readColor("--vscode-editor-foreground", baseTheme.text);
  const accent = readColor("--vscode-focusBorder", baseTheme.accent);
  const border = readColor(
    "--vscode-widget-border",
    readColor("--vscode-panel-border", baseTheme.muted),
  );
  // `muted` is a dual-role neutral: used at full opacity for content (list
  // markers, checkbox outlines, secondary text) and alpha'd for chrome
  // (leafBorder etc.). VSCode's `--vscode-descriptionForeground` is the
  // canonical "muted text" color; it reads as content at full opacity while
  // still feeling subdued, which suits both halves of muted's role. Falls
  // back to the chrome border if descriptionForeground isn't available.
  const muted = readColor("--vscode-descriptionForeground", border);
  const widgetBackground = readColor(
    "--vscode-editorWidget-background",
    readColor("--vscode-quickInput-background", editorBackground),
  );
  // The resolver's mode-aware codeBackground default mirrors what most VS Code
  // themes set --vscode-textCodeBlock-background to, so use the same formula
  // as the fallback when the CSS var is missing.
  const codeBackground = readColor(
    "--vscode-textCodeBlock-background",
    isDark
      ? `color-mix(in srgb, ${editorForeground} 8%, ${editorBackground})`
      : `color-mix(in srgb, ${editorForeground} 60%, #000)`,
  );
  const selectionBackground = readColor(
    "--vscode-editor-selectionBackground",
    baseTheme.selectionBackground ?? colorWithAlpha(accent, 0.28, baseTheme.background),
  );
  const lineHighlightBackground = readColor(
    "--vscode-editor-lineHighlightBackground",
    colorWithAlpha(accent, 0.12, baseTheme.background),
  );

  return {
    accent,
    activeBlockBackground: lineHighlightBackground,
    activeBlockFlash: colorWithAlpha(accent, 0.22, baseTheme.background),
    background: editorBackground,
    codeBackground,
    commentHighlight: baseTheme.commentHighlight,
    commentHighlightActive: baseTheme.commentHighlightActive,
    commentHighlightResolved: baseTheme.commentHighlightResolved,
    commentHighlightResolvedActive: baseTheme.commentHighlightResolvedActive,
    imageSurfaceBackground: widgetBackground,
    imageSurfaceBorder: border,
    muted,
    selectionBackground,
    tableHeaderBackground: readColor(
      "--vscode-sideBar-background",
      colorWithAlpha(editorForeground, isDark ? 0.1 : 0.06, baseTheme.background),
    ),
    text: editorForeground,
  };
}

function isVsCodeDarkTheme(): boolean {
  if (document.body.classList.contains("vscode-dark")) {
    return true;
  }

  if (document.body.classList.contains("vscode-light")) {
    return false;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function readVsCodeColor(
  variableName: string,
  fallback: string,
  rootStyle: CSSStyleDeclaration,
  bodyStyle: CSSStyleDeclaration,
): string {
  const rootValue = rootStyle.getPropertyValue(variableName).trim();
  if (rootValue) {
    return rootValue;
  }

  const bodyValue = bodyStyle.getPropertyValue(variableName).trim();

  return bodyValue || fallback;
}

function colorWithAlpha(color: string, alpha: number, fallback: string): string {
  const rgb = parseCssColor(color);

  if (!rgb) {
    return fallback;
  }

  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function parseCssColor(color: string): { r: number; g: number; b: number } | null {
  const normalized = color.trim();
  const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);

  if (hexMatch) {
    const hex = hexMatch[1];
    const expanded =
      hex.length === 3 || hex.length === 4
        ? hex
            .split("")
            .map((character) => character + character)
            .join("")
        : hex;

    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
    };
  }

  const rgbMatch = normalized.match(/^rgba?\((.+)\)$/i);
  if (!rgbMatch) {
    return null;
  }

  const [r, g, b] = rgbMatch[1]
    .split(/[,\s/]+/)
    .map((part) => Number.parseFloat(part))
    .filter((part) => Number.isFinite(part));

  if (r === undefined || g === undefined || b === undefined) {
    return null;
  }

  return {
    r: Math.round(r),
    g: Math.round(g),
    b: Math.round(b),
  };
}

function areThemesEqual(left: EditorTheme, right: EditorTheme): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([key, value]) => right[key as keyof EditorTheme] === value)
  );
}
