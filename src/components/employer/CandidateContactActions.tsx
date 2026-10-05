import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Phone, MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { logEmployerWhatsappOutreach } from "@/lib/credits.functions";

/**
 * D10: "Call Now" + "WhatsApp" buttons shown next to an unlocked candidate's
 * contact, in both the candidate DB search (database.tsx) and the applicant
 * review panel (ApplicantReviewPanel.tsx, shared with jobs.$jobId.applicants).
 * WhatsApp is disabled (not hidden — a hidden control gives no reason why)
 * when the candidate hasn't opted in or their number is known-invalid;
 * clicking it logs the outreach and enforces the per-post cap server-side
 * before opening wa.me, same guarantees as an automated send.
 */
export function CandidateContactActions({
  companyId,
  jobId,
  candidateUserId,
  mobile,
  whatsappAvailable,
  className,
}: {
  companyId: string;
  jobId: string | null;
  candidateUserId: string;
  mobile: string | null;
  whatsappAvailable: boolean;
  className?: string;
}) {
  const [opening, setOpening] = useState(false);
  const logOutreach = useServerFn(logEmployerWhatsappOutreach);

  const openWhatsapp = async () => {
    if (!jobId) {
      toast.error("Select a job before messaging a candidate on WhatsApp.");
      return;
    }
    // Opened synchronously, inside the click handler's own call stack, and
    // pointed at its real destination only once the server call resolves —
    // most browsers' popup blockers only allow window.open() to bypass them
    // when it runs synchronously from a user gesture. Opening it only after
    // `await logOutreach(...)` resolves would get silently blocked.
    const pending = window.open("", "_blank", "noopener,noreferrer");
    setOpening(true);
    try {
      const { whatsappNumber } = await logOutreach({
        data: { companyId, jobId, candidateUserId },
      });
      const url = `https://wa.me/${whatsappNumber.replace(/^\+/, "")}`;
      if (pending) pending.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      pending?.close();
      const msg = e instanceof Error ? e.message : "Could not open WhatsApp.";
      toast.error(
        msg.includes("cap")
          ? "This job has reached its free WhatsApp outreach limit."
          : msg.includes("Rajasthan")
            ? "Free-plan WhatsApp outreach is limited to Rajasthan candidates."
            : msg.includes("whatsapp_unavailable")
              ? "This candidate hasn't enabled WhatsApp."
              : msg.includes("candidate_not_unlocked")
                ? "Unlock this candidate's contact first."
                : msg,
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      {mobile && (
        <a
          href={`tel:${mobile}`}
          title="Call now"
          aria-label="Call now"
          className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-foreground hover:bg-surface"
        >
          <Phone className="h-3.5 w-3.5" />
        </a>
      )}
      <button
        type="button"
        onClick={openWhatsapp}
        disabled={!whatsappAvailable || opening}
        title={whatsappAvailable ? "Message on WhatsApp" : "Candidate hasn't enabled WhatsApp"}
        aria-label="Message on WhatsApp"
        className="grid h-8 w-8 place-items-center rounded-lg border border-success/30 bg-success-light text-success hover:opacity-90 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface disabled:text-muted-foreground disabled:opacity-60"
      >
        {opening ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <MessageCircle className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
