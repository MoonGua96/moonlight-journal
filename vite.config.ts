import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/target/**"] },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: ["es2021", "chrome105", "safari13"] },
  test: { environment: "jsdom", setupFiles: "./tests/setup.ts" },
});
