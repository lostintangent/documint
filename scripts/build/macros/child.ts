import { join } from "node:path";

export const projectRoot = join(import.meta.dir, "../../..");

// Bun forbids nested builds inside macros, so a macro that needs Bun.build
// runs its own module as a child process and inlines what it prints.
export function runMacroChild(modulePath: string): string {
  const child = Bun.spawnSync(["bun", modulePath], { cwd: projectRoot, stderr: "inherit" });
  if (!child.success) throw new Error(`${modulePath} failed.`);
  return child.stdout.toString();
}
