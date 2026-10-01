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
    // @react-pdf/renderer runs in the browser (live resume preview) and pulls in
    // CommonJS-only deps (e.g. base64-js via @react-pdf/image). Force it into the
    // dependency pre-bundle so Vite converts those to ESM up front — otherwise
    // they're served raw and the page crashes with "does not provide an export
    // named 'default'".
    //
    // The @tanstack/router-core + seroval entries are deps Vite otherwise only
    // discovers mid-session on a cold cache; its late re-optimize reshuffles
    // cache hashes and leaves already-served modules pointing at 404s.
    optimizeDeps: {
      include: [
        "@react-pdf/renderer",
        "@tanstack/router-core",
        "@tanstack/router-core/isServer",
        "@tanstack/router-core/ssr/client",
        "seroval",
      ],
    },
  },
});

