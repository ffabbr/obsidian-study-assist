import esbuild from "esbuild";
import process from "process";

const isProd = process.argv.includes("production");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "browser",
  sourcemap: !isProd,
  minify: isProd,
  target: ["es2019"],
  external: ["obsidian"],
});

if (isProd) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
  console.log("Watching...");
}
