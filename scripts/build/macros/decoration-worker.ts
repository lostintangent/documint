import { join } from "node:path";

const projectRoot = join(import.meta.dir, "../../..");
const entrypoint = join(projectRoot, "src/component/decorations/worker/index.ts");

export function bundleDecorationWorker(): string {
  // Bun forbids nested builds inside macros, so the worker bundles in a child.
  const child = Bun.spawnSync(["bun", "run", import.meta.path, "--compile"], {
    cwd: projectRoot,
  });
  if (child.exitCode !== 0) {
    process.stderr.write(child.stderr);
    throw new Error("Decoration worker failed to bundle.");
  }
  return new TextDecoder().decode(child.stdout);
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

if (process.argv.includes("--compile")) await emitDecorationWorker();
