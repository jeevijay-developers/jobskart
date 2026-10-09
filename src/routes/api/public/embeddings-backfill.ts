import { createFileRoute } from "@tanstack/react-router";
import { checkBackfillAuth, parseBackfillParams } from "@/lib/embeddings-backfill-params";

// Maintenance endpoint for the recommendation engine's embeddings. Not user-facing:
// guarded by a shared secret header (same unconfigured=503 pattern as the webhook routes).
// Call it repeatedly (curl / scheduler) until both `remaining` counts reach 0.
// No GET handler: this route only ever runs a batch, never reports state passively.
export const Route = createFileRoute("/api/public/embeddings-backfill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = checkBackfillAuth(
          request.headers.get("x-backfill-secret"),
          process.env.EMBEDDINGS_BACKFILL_SECRET,
        );
        if (auth === "unconfigured") return new Response("Not configured", { status: 503 });
        if (auth === "forbidden") return new Response("Forbidden", { status: 403 });

        const { mode, limit } = parseBackfillParams(new URL(request.url).searchParams);
        try {
          const { backfillEmbeddings } = await import("@/lib/embeddings-backfill.server");
          const result = await backfillEmbeddings({ mode, limit });
          return Response.json(result);
        } catch (e) {
          // Never leak the real error (may contain internal details) to the caller.
          console.error("[embeddings-backfill] batch failed", e);
          return Response.json({ error: "Backfill failed." }, { status: 500 });
        }
      },
    },
  },
});
