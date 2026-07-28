import type { WordMovement } from "@/editor";

export type EditorHostPlatform = "mac" | "other" | "windows";

type NavigatorPlatform = {
  platform: string;
  userAgent: string;
};

export function resolveEditorHostPlatform(
  environment: NavigatorPlatform = navigator,
): EditorHostPlatform {
  const identity = `${environment.platform} ${environment.userAgent}`;

  if (/Mac|iPhone|iPad|iPod/.test(identity)) {
    return "mac";
  }

  return /Win/.test(identity) ? "windows" : "other";
}

export function resolveEditorForwardWordMovement(
  platform: EditorHostPlatform = resolveEditorHostPlatform(),
): WordMovement {
  return platform === "windows" ? "nextWord" : "wordEnd";
}
