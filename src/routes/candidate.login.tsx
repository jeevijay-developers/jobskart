import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

// Dedicated candidate login entry. Redirects to the unified /auth with the
// candidate tab preselected and any "redirect" target preserved.
export const Route = createFileRoute("/candidate/login")({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/auth",
      search: {
        tab: "candidate" as const,
        ...(search.redirect ? { redirect: search.redirect } : {}),
      },
    });
  },
  component: () => null,
});
