const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * @param {string} label
 * @type {import('esbuild').Plugin}
 */
function esbuildProblemMatcherPlugin(label) {
  return {
    name: `esbuild-problem-matcher-${label}`,

    setup(build) {
      build.onStart(() => {
        console.log(`[watch] ${label} build started`);
      });
      build.onEnd((result) => {
        result.errors.forEach(({ text, location }) => {
          console.error(`✘ [ERROR] ${text}`);
          if (location) {
            console.error(`    ${location.file}:${location.line}:${location.column}:`);
          }
        });
        console.log(`[watch] ${label} build finished`);
      });
    },
  };
}

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
  plugins: [esbuildProblemMatcherPlugin("extension")],
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
  plugins: [reactAliasPlugin, esbuildProblemMatcherPlugin("webview")],
};

async function main() {
  const contexts = await Promise.all([
    esbuild.context(extensionConfig),
    esbuild.context(webviewConfig),
  ]);
  if (watch) {
    await Promise.all(contexts.map((ctx) => ctx.watch()));
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
