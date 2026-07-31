import { join } from "node:path";
import tailwindPlugin from "bun-plugin-tailwind";

const projectRoot = join(import.meta.dir, "../../..");
const stylesheet = join(projectRoot, "src/component/overlays/styles.css");

export function compileOverlayStyles(): string {
  // Bun forbids nested builds inside macros, so Tailwind compiles in a child.
  const child = Bun.spawnSync(["bun", "run", import.meta.path, "--compile"], {
    cwd: projectRoot,
  });
  if (child.exitCode !== 0) {
    process.stderr.write(child.stderr);
    throw new Error("Overlay styles failed to compile.");
  }
  return new TextDecoder().decode(child.stdout);
}

async function emitOverlayStyles(): Promise<void> {
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

if (process.argv.includes("--compile")) await emitOverlayStyles();
