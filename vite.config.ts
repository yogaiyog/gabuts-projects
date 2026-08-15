import { defineConfig } from "vite";

// MediaPipe tasks-vision needs cross-origin isolation for SIMD/WASM perf.
// Serve WASM with correct MIME via Vite's default static handling.
export default defineConfig({
  server: {
    host: true,
    port: 5173,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    host: true,
    port: 4173,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          mediapipe: ["@mediapipe/tasks-vision"],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision", "@ffmpeg/ffmpeg", "@ffmpeg/util", "@ffmpeg/core-mt"],
  },
  assetsInclude: ["**/*.task"],
});
