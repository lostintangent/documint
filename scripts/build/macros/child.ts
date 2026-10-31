import { join } from "node:path";

export const projectRoot = join(import.meta.dir, "../../..");

// Bun forbids nested builds inside macros, so a macro that needs Bun.build
// re-runs its own module as a child with `--compile` and inlines its stdout.
export const isMacroChild = process.argv.includes("--compile");

export function runMacroChild(modulePath: string, failureMessage: string): string {
  const child = Bun.spawnSync(["bun", "run", modulePath, "--compile"], { cwd: projectRoot });
  if (child.exitCode !== 0) {
    process.stderr.write(child.stderr);
    throw new Error(failureMessage);
  }
  return new TextDecoder().decode(child.stdout);
}
