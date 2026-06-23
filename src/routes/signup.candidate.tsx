import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/signup/candidate")({
  beforeLoad: () => {
    throw redirect({ to: "/auth", search: { tab: "candidate" } });
  },
});
