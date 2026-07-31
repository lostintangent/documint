import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readEditorStyles(): string {
  return readFileSync(join(import.meta.dir, "../../../src/component/styles.css"), "utf8");
}
