import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { RescheduleInterviewModal } from "@/components/employer/RescheduleInterviewModal";

export const Route = createFileRoute("/ivfix999")({
  component: TestPage,
});

function TestPage() {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ padding: 16 }}>
      <button onClick={() => setOpen(true)}>Open</button>
      <RescheduleInterviewModal
        open={open}
        onOpenChange={setOpen}
        companyId="test-company"
        interviewId="test-interview"
        currentDurationMin={30}
        onRescheduled={() => console.log("rescheduled!")}
      />
    </div>
  );
}
