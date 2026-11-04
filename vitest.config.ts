import { defineConfig } from "vitest/config"

// Standalone rather than merged into vite.config.ts: the unit suite covers the
// pure numeric layer (masks, alpha refinement, focal depth, the model
// registry), so it needs none of the app's plugins, aliases or worker handling.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // This repo lives on an exFAT volume, where macOS writes an AppleDouble
    // sidecar next to every file. `._brush.test.ts` is a binary resource fork,
    // not a test, and vitest tries to transform it. `pnpm prebuild` deletes
    // them, but they come back the moment Finder touches the directory.
    exclude: ["**/node_modules/**", "**/dist/**", "**/._*"],
  },
})
