import { join } from "node:path";
import { isMacroChild, projectRoot, runMacroChild } from "./child";

const stylesheet = join(projectRoot, "src/component/overlays/styles.css");

export function compileOverlayStyles(): string {
  return runMacroChild(import.meta.path, "Overlay styles failed to compile.");
}

async function emitOverlayStyles(): Promise<void> {
  // Loading Tailwind only in the child keeps Bun's macro sandbox from initializing the plugin.
  const { default: tailwindPlugin } = await import("bun-plugin-tailwind");
  const build = await Bun.build({
    entrypoints: [stylesheet],
    plugins: [tailwindPlugin],
    minify: true,
  });
  if (!build.success) {
    build.logs.forEach(console.error);
    process.exit(1);
  }
  const output = build.outputs.find((candidate) => candidate.path.endsWith(".css"));
  if (!output) throw new Error("Overlay styles did not emit CSS.");
  process.stdout.write(await output.text());
}

if (isMacroChild) await emitOverlayStyles();
