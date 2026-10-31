import { join } from "node:path";
import { isMacroChild, projectRoot, runMacroChild } from "./child";

const entrypoint = join(projectRoot, "src/component/decorations/worker/index.ts");

export function bundleDecorationWorker(): string {
  return runMacroChild(import.meta.path, "Decoration worker failed to bundle.");
}

async function emitDecorationWorker(): Promise<void> {
  const build = await Bun.build({
    entrypoints: [entrypoint],
    target: "browser",
    format: "esm",
    minify: process.env.NODE_ENV === "production",
  });
  if (!build.success) {
    build.logs.forEach(console.error);
    process.exit(1);
  }
  const output = build.outputs.find((candidate) => candidate.kind === "entry-point");
  if (!output) throw new Error("Decoration worker did not emit JavaScript.");
  process.stdout.write(await output.text());
}

if (isMacroChild) await emitDecorationWorker();
