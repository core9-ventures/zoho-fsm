import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = path.dirname(fileURLToPath(import.meta.url));

// The server the app talks to is set at build time (see .env.example).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The server's shared schemas (zod) live in ../src and import each other as "@/...".
  resolve: { alias: { "@": path.resolve(here, "../src") } },
  // Tailwind runs as a Vite plugin here; do not load the web app's PostCSS config from the parent folder.
  css: { postcss: { plugins: [] } },
  // `VITE_READABLE=1 node scripts/build-apk.mjs` builds an APK with readable names in error messages (for finding a crash).
  build: { minify: process.env.VITE_READABLE ? false : undefined },
  server: { port: 5173, host: true, fs: { allow: [path.resolve(here, "..")] } },
});
