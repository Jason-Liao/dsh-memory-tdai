// Build: bundle src/index.ts into one ESM file at lib/index.js.
// Native / wasm / http deps stay external and resolve from the installed
// package's node_modules at runtime.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: "lib/index.js",
  external: [
    "@node-rs/jieba",
    "@node-rs/jieba/*",
    "sqlite-vec",
    "undici",
    "@tencentdb-agent-memory/tcvdb-text",
    "tcvdb",
    "node-llama-cpp",
  ],
  sourcemap: false,
  logLevel: "info",
});
console.log("built lib/index.js");

// Test entry: exports the core pieces for the smoke test.
await build({
  entryPoints: ["src/smoke-entry.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: "lib/smoke.js",
  external: [
    "@node-rs/jieba",
    "@node-rs/jieba/*",
    "sqlite-vec",
    "undici",
    "@tencentdb-agent-memory/tcvdb-text",
    "tcvdb",
    "node-llama-cpp",
  ],
  sourcemap: false,
  logLevel: "info",
});
console.log("built lib/smoke.js");
