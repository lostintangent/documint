import { rmSync } from "fs";
import { BuildOutput } from "bun";

// Build modes:
//
//   - `dev` — fast verification build for CI. Bundles both the library
//     (`src/index.ts`) and the playground (`playground/index.html`)
//     without minification, with external sourcemaps. Skips type-
//     declaration generation, which is slow and only relevant at publish
//     time. Used by `.github/workflows/ci.yml` to confirm both entry
//     points still bundle on every push / PR.
//
//   - `prod` — publishable library artifact. Minified library bundle
//     plus `dist/index.d.ts` from `dts-bundle-generator`. Used by
//     `.github/workflows/publish.yml` (and the `build:prod` script
//     locally for inspection of the prod-shaped bundle).
//
//   - `playground` — deployable demo. Minified playground bundle.
//     Used by `.github/workflows/playground.yml`.
//
// All three modes substitute `process.env.NODE_ENV` with `"production"`,
// which folds every `if (process.env.NODE_ENV !== "production")` gate in
// the source (see `src/component/lib/diagnostics.ts`) to `false`. The
// minifier then dead-code-eliminates every gated branch. (`dev` mode
// here is for CI / static-bundle inspection; the live dev server,
// `bun run dev`, doesn't go through this script and so doesn't
// substitute `process.env.NODE_ENV`, picking up Bun's HMR-bundler
// default of `"development"` — diagnostics light up.)
type BuildMode = "dev" | "prod" | "playground";

const mode = resolveMode(process.argv);

// Shared between library + playground builds. `process.env.NODE_ENV` is
// the de-facto convention for browser bundlers (React, Vue, etc. read it
// at module scope), so substituting it here produces correctly-shaped
// production bundles for every consumer.
const define = {
  "process.env.NODE_ENV": JSON.stringify("production"),
};

// Step 1 (all modes): Build the library bundle.
const libraryBuild = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "browser",
  format: "esm",
  sourcemap: mode === "dev" ? "external" : "none",
  splitting: false,
  external: ["react", "react-dom", "react/jsx-runtime"],
  ...(mode !== "dev" && { minify: true }),
  define,
});

assertBuildSuccess(libraryBuild, "Library");

for (const output of libraryBuild.outputs) {
  console.log(`  ${output.path} (${(output.size / 1024).toFixed(1)} KB)`);
}

// Step 2 (prod only): Bundle type declarations into a single dist/index.d.ts
if (mode === "prod") {
  // Remove stale artifacts from prior builds before writing the declaration bundle.
  const staleArtifacts = [
    "dist/comments",
    "dist/component",
    "dist/document",
    "dist/editor",
    "dist/index.d.ts",
    "dist/index.js.map",
    "dist/markdown",
  ];
  for (const path of staleArtifacts) {
    rmSync(path, { recursive: true, force: true });
  }

  console.log("\nGenerating type declarations...");

  const dts = Bun.spawnSync(
    [
      "dts-bundle-generator",
      "--project",
      "tsconfig.json",
      "--out-file",
      "dist/index.d.ts",
      "--no-banner",
      "--no-check",
      "--export-referenced-types",
      "false",
      "src/index.ts",
    ],
    {
      stdio: ["inherit", "inherit", "inherit"],
    },
  );

  if (dts.exitCode !== 0) {
    throw new Error("Type declaration generation failed.");
  }

  console.log("Package build complete. Ready to publish.");
}

// Step 3 (dev + playground): Build the playground app
if (mode !== "prod") {
  rmSync("dist/playground", { recursive: true, force: true });

  const playgroundBuild = await Bun.build({
    entrypoints: ["playground/index.html"],
    outdir: "dist/playground",
    target: "browser",
    sourcemap: mode === "dev" ? "external" : "none",
    ...(mode === "playground" && { minify: true }),
    define,
  });

  assertBuildSuccess(playgroundBuild, "Playground");

  console.log(
    `\nBuilt ${libraryBuild.outputs.length} library outputs and ${playgroundBuild.outputs.length} playground outputs.`,
  );
}

function resolveMode(argv: string[]): BuildMode {
  if (argv.includes("--prod")) return "prod";
  if (argv.includes("--playground")) return "playground";
  return "dev";
}

function assertBuildSuccess(build: BuildOutput, name: string) {
  if (!build.success) {
    build.logs.forEach(console.error);
    throw new Error(`${name} build failed.`);
  }
}
