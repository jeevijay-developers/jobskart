import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/signup/employer")({
  beforeLoad: () => {
    throw redirect({ to: "/auth", search: { tab: "employer" } });
  },
});
