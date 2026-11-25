import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  envDir: ".",
  plugins: [
    react(),
    VitePWA({
      disable: process.env.CAPACITOR === "1",
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "MixNotes",
        short_name: "MixNotes",
        description: "Listen to your exports and leave timestamped notes",
        theme_color: "#111114",
        background_color: "#111114",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [],
      },
    }),
  ],
  server: { port: 5173 },
});
