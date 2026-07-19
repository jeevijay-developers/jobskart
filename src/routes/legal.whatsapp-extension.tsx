import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/legal/whatsapp-extension")({
  head: () => ({ meta: [
    { title: "WhatsApp Extension Terms · JobsKart" },
    { name: "description", content: "Terms & conditions for JobsKart's Chrome extension for bulk WhatsApp candidate outreach." },
  ] }),
  component: WhatsAppExtTerms,
});

function WhatsAppExtTerms() {
  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-warning" />
          <h1 className="text-3xl font-black tracking-tight">WhatsApp Extension — Terms & Conditions</h1>
        </div>
        <p className="text-muted-foreground">JobsKart provides an optional Chrome extension to help employers reach shortlisted candidates on WhatsApp. Use of this extension is subject to the following.</p>

        <ol className="mt-6 list-decimal space-y-3 pl-6 text-sm text-foreground/85">
          <li><strong>Daily limit — 50 messages per user per day.</strong> The extension and our servers enforce this cap. Attempts beyond the cap are blocked and logged.</li>
          <li><strong>Opt-in only.</strong> Only message candidates who have applied to your jobs or explicitly consented to be contacted. Unsolicited outreach is grounds for suspension.</li>
          <li><strong>No spam / mass marketing.</strong> The extension is for hiring outreach — not promotions, offers, or bulk marketing. Blocking, reports, or high complaint rates lead to WhatsApp-side bans that we cannot reverse.</li>
          <li><strong>Personal WhatsApp only.</strong> Do not use JobsKart's extension with WhatsApp Business API without an approved BSP integration.</li>
          <li><strong>Suspension.</strong> We may suspend your account and extension access without notice if we detect unauthorised access, spam patterns, high block rates, or automated behavior beyond the documented cap.</li>
          <li><strong>Data handling.</strong> The extension reads the candidate's phone number for the current message only. It does not scrape chat history or upload your WhatsApp data to JobsKart servers.</li>
          <li><strong>Liability.</strong> You are solely responsible for the content of your messages and any consequences (WhatsApp bans, complaints, legal claims) arising from your outreach.</li>
        </ol>

        <div className="mt-8 rounded-2xl border border-warning/30 bg-warning-light p-4 text-sm text-warning">
          By installing or using the JobsKart WhatsApp extension you agree to these terms. Continuing to use JobsKart after any update to these terms constitutes acceptance.
        </div>
      </main>
      <Footer />
    </div>
  );
}
