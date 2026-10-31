const esbuild = require("esbuild");

const production = process.argv.includes("--production");

/**
 * @type {import('esbuild').Plugin}
 */
const reactAliasPlugin = {
  name: "react-alias",

  setup(build) {
    build.onResolve({ filter: /^react($|\/)|^react-dom($|\/)/ }, (args) => ({
      path: require.resolve(args.path),
    }));
  },
};

const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: "node",
  outfile: "dist/extension.js",
  external: ["vscode"],
  logLevel: "silent",
};

const webviewConfig = {
  entryPoints: ["src/webview/main.tsx"],
  bundle: true,
  format: "esm",
  minify: production,
  preserveSymlinks: true,
  sourcemap: !production,
  sourcesContent: false,
  platform: "browser",
  target: "es2022",
  outfile: "dist/webview/main.js",
  define: {
    "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
  },
  logLevel: "silent",
  jsx: "automatic",
  plugins: [reactAliasPlugin],
};

async function main() {
  await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
