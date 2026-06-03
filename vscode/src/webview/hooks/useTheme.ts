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
  const accent = readColor("--vscode-focusBorder", baseTheme.leafAccent);
  const border = readColor(
    "--vscode-widget-border",
    readColor("--vscode-panel-border", baseTheme.leafBorder),
  );
  const widgetBackground = readColor(
    "--vscode-editorWidget-background",
    readColor("--vscode-quickInput-background", editorBackground),
  );
  const codeBackground = readColor("--vscode-textCodeBlock-background", baseTheme.codeBackground);
  const selectionBackground = readColor(
    "--vscode-editor-selectionBackground",
    baseTheme.selectionBackground,
  );
  const lineHighlightBackground = readColor(
    "--vscode-editor-lineHighlightBackground",
    colorWithAlpha(accent, 0.12, baseTheme.activeBlockBackground),
  );

  return {
    activeBlockBackground: lineHighlightBackground,
    activeBlockFlash: colorWithAlpha(accent, 0.22, baseTheme.activeBlockFlash),
    background: editorBackground,
    blockquoteRule: colorWithAlpha(accent, 0.32, baseTheme.blockquoteRule),
    blockquoteRuleActive: colorWithAlpha(accent, 0.56, baseTheme.blockquoteRuleActive),
    checkboxCheckmark: editorBackground,
    checkboxCheckedFill: accent,
    checkboxCheckedStroke: accent,
    checkboxUncheckedFill: editorBackground,
    checkboxUncheckedStroke: border,
    codeBackground,
    commentHighlight: baseTheme.commentHighlight,
    commentHighlightActive: baseTheme.commentHighlightActive,
    commentHighlightResolved: baseTheme.commentHighlightResolved,
    commentHighlightResolvedActive: baseTheme.commentHighlightResolvedActive,
    headingRule: border,
    imageLoadingOverlay: colorWithAlpha(editorBackground, 0.48, baseTheme.imageLoadingOverlay),
    imagePlaceholderIcon: colorWithAlpha(accent, 0.42, baseTheme.imagePlaceholderIcon),
    imageSurfaceBackground: widgetBackground,
    imageSurfaceBorder: border,
    inlineCodeBackground: codeBackground,
    leafAccent: accent,
    leafBorder: border,
    leafInputBackground: baseTheme.leafInputBackground,
    leafResolvedBackground: baseTheme.leafResolvedBackground,
    leafResolvedBorder: baseTheme.leafResolvedBorder,
    selectionBackground,
    selectionHandleBackground: editorBackground,
    selectionHandleBorder: accent,
    tableBodyBackground: editorBackground,
    tableBorder: border,
    tableHeaderBackground: readColor(
      "--vscode-sideBar-background",
      colorWithAlpha(editorForeground, isDark ? 0.1 : 0.06, baseTheme.tableHeaderBackground),
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
