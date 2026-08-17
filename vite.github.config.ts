import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/gm-manager/",
  plugins: [react()],
  build: {
    outDir: "github-pages",
    emptyOutDir: true,
  },
});
