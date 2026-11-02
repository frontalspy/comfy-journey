import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const API_TARGET = process.env.COMFY_API_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in production; in development Vite forwards the API (including the SSE stream).
    proxy: { "/api": { target: API_TARGET, changeOrigin: false } },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        // Long-lived vendor chunks cache across deploys of app code.
        manualChunks(id: string): string | undefined {
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (/node_modules[\\/](react-router|react-router-dom)[\\/]/.test(id)) return "router";
          if (/node_modules[\\/](@tanstack|zod)[\\/]|shared[\\/]dist/.test(id)) return "data";
          return undefined;
        },
      },
    },
  },
  test: { environment: "jsdom", globals: false, include: ["src/**/*.test.{ts,tsx}"] },
});
