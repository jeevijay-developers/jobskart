// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [mcpPlugin()],
    // pdfkit is a Node.js-only package (uses Buffer, stream, fs).
    // Exclude it from the client dependency scanner so Vite never tries
    // to bundle it for the browser, which causes ECONNRESET on startup.
    optimizeDeps: {
      exclude: ["pdfkit"],
    },
    // Mark pdfkit as server-side external so it's loaded via Node require()
    // in the SSR context rather than being inlined/bundled by Vite.
    ssr: {
      external: ["pdfkit"],
    },
  },
});

