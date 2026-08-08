import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("api", { recursive: true });

await build({
  entryPoints: ["server/vercel/handler.ts"],
  outfile: "api/[...path].js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  packages: "external",
  logLevel: "info"
});
