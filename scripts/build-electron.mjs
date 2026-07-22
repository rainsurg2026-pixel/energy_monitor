// Bundles the Electron main process and preload script with esbuild.
// Output is CommonJS (.cjs) so it works regardless of package.json "type",
// and the preload stays compatible with the sandboxed renderer.
import { build } from "esbuild";
import { fileURLToPath } from "url";
import path from "path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: false,
  minify: false,
  logLevel: "info"
};

await build({
  ...shared,
  entryPoints: [path.join(root, "src/electron/bootstrap.ts")],
  outfile: path.join(root, "dist-electron/main.cjs")
});

await build({
  ...shared,
  entryPoints: [path.join(root, "src/electron/preload.ts")],
  outfile: path.join(root, "dist-electron/preload.cjs")
});
