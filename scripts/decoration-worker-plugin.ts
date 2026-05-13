import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { BunPlugin } from "bun";

const decorationWorkerPlugin: BunPlugin = {
  name: "documint-decoration-worker",
  setup(build) {
    let workerSourcePromise: Promise<string> | null = null;
    const cacheWorkerSource = process.env.NODE_ENV === "production";

    build.onLoad({ filter: /src\/component\/worker\/source\.ts$/ }, async () => ({
      contents: `export default ${JSON.stringify(await resolveWorkerSource())};`,
      loader: "js",
    }));

    function resolveWorkerSource() {
      if (!cacheWorkerSource) {
        return buildDecorationWorkerSource();
      }

      workerSourcePromise ??= buildDecorationWorkerSource();
      return workerSourcePromise;
    }
  },
};

async function buildDecorationWorkerSource() {
  const outputDirectory = mkdtempSync(join(tmpdir(), "documint-worker-"));
  const outputFile = join(outputDirectory, "worker.js");

  try {
    const build = Bun.spawnSync([
      "bun",
      "build",
      "src/component/worker/index.ts",
      "--target=browser",
      "--format=esm",
      "--outfile",
      outputFile,
      ...(process.env.NODE_ENV === "production" ? ["--minify"] : []),
    ]);

    if (build.exitCode !== 0) {
      throw new Error("Decoration worker build failed.");
    }

    return readFileSync(outputFile, "utf8");
  } finally {
    rmSync(outputDirectory, { force: true, recursive: true });
  }
}

export default decorationWorkerPlugin;
