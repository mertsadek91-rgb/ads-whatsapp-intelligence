import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: proxy /api to the Node server on :3000.
//
// Build: emits into ../server/public, NOT web/dist. The server serves these
// files, so they belong inside the server package rather than in a sibling one
// it reaches into with "../../web/dist". That relative reach worked on a
// developer's machine and on Docker, and broke the moment a host deployed just
// the configured root directory: the release contained server/ alone, the
// built front end was two levels up in a directory that no longer existed, and
// every page 503'd while the API answered perfectly.
//
// A deployable unit should be one directory. This is what makes it one.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
  build: {
    outDir: "../server/public",
    emptyOutDir: true,
    // BUG-041 fix: isolate recharts (the largest single dependency) into its
    // own vendor chunk so pages that don't use charts (Leads, Conversations,
    // Settings...) don't pull it in, and it stays cached across route changes.
    rollupOptions: { output: { manualChunks: { recharts: ["recharts"] } } },
  },
});
