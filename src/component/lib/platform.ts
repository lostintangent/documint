export type EditorPlatform = "mac" | "nonMac";

type NavigatorPlatform = {
  platform: string;
  userAgent: string;
};

export function resolveEditorPlatform(
  environment: NavigatorPlatform | null = typeof navigator === "undefined" ? null : navigator,
): EditorPlatform {
  if (!environment) {
    return "nonMac";
  }

  return /Mac|iPhone|iPad|iPod/.test(environment.platform || environment.userAgent)
    ? "mac"
    : "nonMac";
}
