import { join } from "node:path";
import { projectRoot, runMacroChild } from "./child";

export function bundleDecorationWorker(): string {
  return runMacroChild(import.meta.path);
}

if (import.meta.main) {
  const { outputs } = await Bun.build({
    entrypoints: [join(projectRoot, "src/component/decorations/worker/index.ts")],
    minify: true,
  });
  process.stdout.write(await outputs[0].text());
}
