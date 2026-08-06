import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      // We call registerSW ourselves from src/main.tsx (via the
      // virtual:pwa-register module) so the update-available banner can be
      // driven by app state instead of a silent auto-injected script.
      injectRegister: false,
      manifest: {
        name: "FinanceFlow",
        short_name: "FinanceFlow",
        display: "standalone",
        start_url: "/",
        // F14: explicit, matching `start_url` — without it, the service
        // worker's scope silently breaks if the app is ever served from a
        // subpath rather than the domain root.
        scope: "/",
        background_color: "#07080f",
        theme_color: "#07080f",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
      },
    }),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
