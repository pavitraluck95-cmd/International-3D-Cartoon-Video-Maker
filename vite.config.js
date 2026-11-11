import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const publicRoot = resolve(process.cwd(), "public");
export default defineConfig({
  root: publicRoot,
  publicDir: false,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(process.cwd(), "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(publicRoot, "index.html"),
        editor: resolve(publicRoot, "editor.html"),
        threeTest: resolve(publicRoot, "3d-test.html"),
        threeVideo: resolve(publicRoot, "3d-video.html")
      }
    }
  }
});