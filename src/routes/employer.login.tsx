import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

// Dedicated employer login entry point. Redirects to the unified /auth page
// with the employer tab preselected and the original "redirect" target preserved.
export const Route = createFileRoute("/employer/login")({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/auth",
      search: {
        tab: "employer" as const,
        ...(search.redirect ? { redirect: search.redirect } : {}),
      },
    });
  },
  component: () => null,
});
