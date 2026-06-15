import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { BunPlugin } from "bun";
import tailwindPlugin from "bun-plugin-tailwind";

// Serves build-time-generated content for "virtual" modules — files the
// codebase imports but whose contents are produced fresh per build, not
// checked into source. The on-disk paths exist as empty stub files so
// non-plugin contexts (`bun test`, direct imports) can still resolve the
// import and get an empty fallback.
//
// Each spec maps an import-path filter to a compile function. Production
// builds memoize each spec's result for the lifetime of the build; dev
// recomputes on every load so HMR picks up edits.

type VirtualModuleSpec = {
  filter: RegExp;
  loader: "js" | "text";
  compile: () => string | Promise<string>;
  wrap?: (content: string) => string;
};

const virtualModulesPlugin: BunPlugin = {
  name: "documint-virtual-modules",
  setup(build) {
    const cache = new Map<VirtualModuleSpec, Promise<string>>();
    const shouldCache = process.env.NODE_ENV === "production";

    for (const spec of virtualModuleSpecs) {
      build.onLoad({ filter: spec.filter }, async () => {
        const content = await resolve(spec);
        return {
          contents: spec.wrap ? spec.wrap(content) : content,
          loader: spec.loader,
        };
      });
    }

    function resolve(spec: VirtualModuleSpec): Promise<string> {
      if (!shouldCache) return Promise.resolve(spec.compile());
      let promise = cache.get(spec);
      if (!promise) {
        promise = Promise.resolve(spec.compile());
        cache.set(spec, promise);
      }
      return promise;
    }
  },
};

const virtualModuleSpecs: readonly VirtualModuleSpec[] = [
  {
    // Bundled decoration worker source, inlined as a JS default-export
    // string so the host can `new Worker(URL.createObjectURL(new Blob([s])))`.
    filter: /src\/component\/decorations\/worker\/source\.ts$/,
    loader: "js",
    wrap: (source) => `export default ${JSON.stringify(source)};`,
    compile: buildDecorationWorker,
  },
  {
    // Compiled, minified Tailwind utilities for the shadow-portal overlay layer.
    filter: /src\/component\/overlays\/generated\.css$/,
    loader: "text",
    compile: compileTailwindStyles,
  },
];

function buildDecorationWorker(): string {
  const outputDirectory = mkdtempSync(join(tmpdir(), "documint-worker-"));
  const outputFile = join(outputDirectory, "worker.js");

  try {
    const build = Bun.spawnSync([
      "bun",
      "build",
      "src/component/decorations/worker/index.ts",
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

// Tailwind needs `bun-plugin-tailwind` loaded, which the CLI can't do
// per invocation — so spawn this file back into a `--compile` mode that
// runs `Bun.build` programmatically and pipes the CSS to stdout. An
// inline `await Bun.build(...)` here would deadlock: nested Bun.build
// calls inside an onLoad handler hang.
function compileTailwindStyles(): string {
  const proc = Bun.spawnSync(["bun", "run", import.meta.path, "--compile"]);

  if (proc.exitCode !== 0) {
    process.stderr.write(proc.stderr);
    throw new Error("Tailwind styles compile failed.");
  }

  return new TextDecoder().decode(proc.stdout);
}

async function compileTailwindStylesAndWriteToStdout() {
  const outputDirectory = mkdtempSync(join(tmpdir(), "documint-styles-"));

  try {
    const build = await Bun.build({
      entrypoints: ["src/component/overlays/styles.css"],
      outdir: outputDirectory,
      plugins: [tailwindPlugin],
      minify: true,
    });

    if (!build.success) {
      build.logs.forEach((log) => console.error(log));
      process.exit(1);
    }

    const cssOutput = build.outputs.find((output) => output.path.endsWith(".css"));
    if (!cssOutput) {
      console.error("Tailwind styles build did not emit CSS.");
      process.exit(1);
    }

    process.stdout.write(await cssOutput.text());
  } finally {
    rmSync(outputDirectory, { force: true, recursive: true });
  }
}

if (process.argv.includes("--compile")) {
  await compileTailwindStylesAndWriteToStdout();
}

export default virtualModulesPlugin;
