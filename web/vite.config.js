import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: proxy /api to the Node server on :3000. Build: emits web/dist (served by Node).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // BUG-041 fix: isolate recharts (the largest single dependency) into its
    // own vendor chunk so pages that don't use charts (Leads, Conversations,
    // Settings...) don't pull it in, and it stays cached across route changes.
    rollupOptions: { output: { manualChunks: { recharts: ["recharts"] } } },
  },
});
