import { useEffect, useState } from "react";
import { darkTheme, lightTheme, type EditorTheme } from "@lostintangent/documint";

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

  const readColor = (variableName: string) => readVsCodeColor(variableName, rootStyle, bodyStyle);

  const editorBackground = readColor("--vscode-editor-background") ?? baseTheme.background;
  const editorForeground = readColor("--vscode-editor-foreground") ?? baseTheme.text;
  const accent = readColor("--vscode-focusBorder") ?? baseTheme.accent;
  const border =
    readColor("--vscode-widget-border") ?? readColor("--vscode-panel-border") ?? baseTheme.muted;
  // `muted` is a dual-role neutral: used at full opacity for content (list
  // markers, checkbox outlines, secondary text) and alpha'd for chrome
  // (leafBorder etc.). VSCode's `--vscode-descriptionForeground` is the
  // canonical "muted text" color; it reads as content at full opacity while
  // still feeling subdued, which suits both halves of muted's role. Falls
  // back to the chrome border if descriptionForeground isn't available.
  const muted = readColor("--vscode-descriptionForeground") ?? border;
  const widgetBackground =
    readColor("--vscode-editorWidget-background") ??
    readColor("--vscode-quickInput-background") ??
    editorBackground;
  // VS Code exposes the editor font size as a `<n>px` string on the document
  // root; mirror it so Documint's typography matches the user's editor
  // settings out of the box. Heading sizes and inline code derive from this
  // in the resolver, so picking up the right base value scales the whole
  // hierarchy in lockstep.
  //
  // macOS gets a +2 nudge: VS Code's `editor.fontSize` default is 12 there
  // (versus 14 on Windows/Linux), which is configured for code and reads too
  // small for prose. Bumping by 2 on macOS lands the default at 14 (and
  // tracks any custom editor size the user picked, just always 2 above).
  // Windows/Linux pass through unchanged — their 14 default is already in
  // prose-acceptable territory.
  const editorFontSize = parseFontSize(rootStyle, bodyStyle);
  const fontSize = editorFontSize !== undefined && isMacOs() ? editorFontSize + 2 : editorFontSize;

  // Colors VS Code leaves unset (`undefined`) fall through to the resolver's
  // accent- and text-derived defaults.
  return {
    accent,
    activeBlockBackground: readColor("--vscode-editor-lineHighlightBackground"),
    background: editorBackground,
    codeBackground: readColor("--vscode-textCodeBlock-background"),
    commentHighlight: baseTheme.commentHighlight,
    commentHighlightActive: baseTheme.commentHighlightActive,
    commentHighlightResolved: baseTheme.commentHighlightResolved,
    commentHighlightResolvedActive: baseTheme.commentHighlightResolvedActive,
    fontSize,
    imageSurfaceBackground: widgetBackground,
    imageSurfaceBorder: border,
    muted,
    selectionBackground:
      readColor("--vscode-editor-selectionBackground") ?? baseTheme.selectionBackground,
    tableHeaderBackground:
      readColor("--vscode-sideBar-background") ??
      `color-mix(in srgb, ${editorForeground} ${isDark ? 10 : 6}%, transparent)`,
    text: editorForeground,
  };
}

function parseFontSize(
  rootStyle: CSSStyleDeclaration,
  bodyStyle: CSSStyleDeclaration,
): number | undefined {
  const raw =
    rootStyle.getPropertyValue("--vscode-editor-font-size").trim() ||
    bodyStyle.getPropertyValue("--vscode-editor-font-size").trim();
  const match = raw.match(/^(\d+(?:\.\d+)?)(?:px)?$/);
  return match ? Number.parseFloat(match[1]!) : undefined;
}

// VS Code webviews run in Chromium so navigator is reliably present. The
// user-agent string is preferred over the deprecated `navigator.platform`.
function isMacOs(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
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
  rootStyle: CSSStyleDeclaration,
  bodyStyle: CSSStyleDeclaration,
): string | undefined {
  return (
    rootStyle.getPropertyValue(variableName).trim() ||
    bodyStyle.getPropertyValue(variableName).trim() ||
    undefined
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
