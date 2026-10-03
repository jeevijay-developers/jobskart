import { useEffect, useState } from "react";

// @react-pdf/font's browser entry registers the standard PDF fonts (Helvetica
// etc.) as a module-load side effect. @react-pdf/renderer's own bare-specifier
// import of @react-pdf/font is *supposed* to pick that browser entry via its
// package.json "browser" field remap client-side (and the Node entry
// server-side, for renderResumePdf.server.ts's renderToBuffer) — but under
// Nitro's "vercel" preset specifically, the client build resolves it to the
// Node entry instead, which expects to load font metrics from the filesystem
// and never runs the registration. Every render then throws `Standard font
// "Helvetica" is not registered`, caught internally by react-pdf's usePDF()
// hook, which only console.errors it and leaves the PDFViewer iframe's src
// unset — a permanently blank preview with no visible error, in production
// only (confirmed: reproduces under `NITRO_PRESET=vercel`, not under
// `cloudflare-module` or `node-server`). Force the browser entry explicitly by
// its exact file path, which can't be remapped the wrong way.
//
// Must be a *dynamic* import, not a static one: `ssr:false` on the resume
// builder route doesn't exempt this module from being statically analyzed by
// the *server* build too (just from executing server-side), and
// @react-pdf/font/lib/index.browser.js itself does
// `import { registerStdFonts } from 'pdfkit'` — a named import that doesn't
// exist on pdfkit's Node entry, so a static import here fails the server
// build outright (confirmed under `NITRO_PRESET=node-server`). A dynamic
// import inside `!import.meta.env.SSR` is dead-code-eliminated for the server
// build before Rollup ever tries to resolve it.
let fontsReadyPromise: Promise<unknown> | null = null;

function ensureStandardFontsRegistered(): Promise<unknown> {
  if (import.meta.env.SSR) return Promise.resolve();
  fontsReadyPromise ??= import("@react-pdf/font/lib/index.browser.js");
  return fontsReadyPromise;
}

// Cached across mounts, so a second <PDFViewer> (e.g. the version-preview
// modal) resolves instantly once the first one has already registered fonts —
// but every caller still waits for the real promise, instead of racing a
// fire-and-forget import against react-pdf's render-on-mount.
export function useStandardFontsReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    ensureStandardFontsRegistered().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return ready;
}
