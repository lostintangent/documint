export {};

const packageEntries = ["src/index.ts"];

const packageBuild = await Bun.build({
  entrypoints: packageEntries,
  outdir: "dist",
  target: "browser",
  format: "esm",
  sourcemap: "external",
  external: ["react", "react-dom", "react/jsx-runtime"],
});

if (!packageBuild.success) {
  for (const log of packageBuild.logs) {
    console.error(log);
  }

  throw new Error("Package build failed.");
}

const appBuild = await Bun.build({
  entrypoints: ["playground/index.html"],
  outdir: "dist/playground",
  target: "browser",
  sourcemap: "external",
});

if (!appBuild.success) {
  for (const log of appBuild.logs) {
    console.error(log);
  }

  throw new Error("Playground build failed.");
}

console.log(
  `Built ${packageBuild.outputs.length} package outputs and ${appBuild.outputs.length} playground outputs.`,
);
