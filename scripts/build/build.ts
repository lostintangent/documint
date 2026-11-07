import { $ } from "bun";
import tailwind from "bun-plugin-tailwind";

// Bundles the library, the playground, or both:
//
//   - dev (default): CI's bundle check of both, unminified with external sourcemaps.
//   - --prod: the minified library that npm publishes. tsdown writes dist/index.d.ts first.
//   - --playground: the minified, single-file playground that GitHub Pages deploys.
//
// Every mode defines `process.env.NODE_ENV` as "production", so the minifier strips the
// diagnostics gates (see src/component/lib/diagnostics.ts). `bun dev` doesn't run this
// script, so the dev server keeps them.
const mode = process.argv.includes("--prod")
  ? "prod"
  : process.argv.includes("--playground")
    ? "playground"
    : "dev";

const options = {
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  // The React Compiler only runs on .tsx/.jsx, so parse .ts as tsx to compile hooks too.
  loader: { ".ts": "tsx" },
  reactCompiler: true,
  minify: mode !== "dev",
  sourcemap: mode === "dev" ? "external" : "none",
} satisfies Partial<Bun.BuildConfig>;

if (mode !== "playground") {
  const { outputs } = await Bun.build({
    ...options,
    entrypoints: ["src/index.ts"],
    outdir: "dist",
    external: ["react", "react-dom", "react/jsx-runtime"],
  });
  for (const { path, size } of outputs) console.log(`  ${path} (${(size / 1024).toFixed(1)} KB)`);
}

if (mode !== "prod") {
  await $`rm -rf dist/playground`;
  await Bun.build({
    ...options,
    entrypoints: ["playground/index.html"],
    outdir: "dist/playground",
    plugins: [tailwind],
    compile: mode === "playground",
  });
}
