import { join } from "node:path";
import { projectRoot, runMacroChild } from "./child";

export function compileOverlayStyles(): string {
  return runMacroChild(import.meta.path);
}

if (import.meta.main) {
  // Loading Tailwind only in the child keeps Bun's macro sandbox from initializing the plugin.
  const { default: tailwind } = await import("bun-plugin-tailwind");
  const { outputs } = await Bun.build({
    entrypoints: [join(projectRoot, "src/component/overlays/styles.css")],
    plugins: [tailwind],
    minify: true,
  });
  process.stdout.write(await outputs[0].text());
}
