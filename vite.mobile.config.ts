import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/",
  plugins: [
    react(),
    {
      name: "gm-manager-mobile-entry",
      transformIndexHtml: {
        order: "pre",
        handler: (html) => html
          .replace('src="/src/main.tsx"', 'src="/src/mobile-main.ts"')
          .replace(/^[ \t]*<link rel="(?:manifest|apple-touch-icon)"[^>]*>[ \t]*\r?\n/gm, ""),
      },
    },
  ],
  build: {
    target: ["chrome111", "safari16", "ios16"],
    cssTarget: "safari16",
    outDir: "mobile/www",
    emptyOutDir: true,
  },
});
