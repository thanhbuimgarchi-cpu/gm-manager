import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/gm-manager/",
  plugins: [react()],
  build: {
    target: ["chrome111", "edge111", "firefox114", "safari16", "ios16"],
    cssTarget: "safari16",
    outDir: "github-pages",
    emptyOutDir: true,
  },
});
