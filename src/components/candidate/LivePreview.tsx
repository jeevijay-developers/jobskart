import { DomResumeTemplate } from "@/lib/resumeBuilder/templates/DomResumeTemplate";
import type { ResumeLayoutSettings, ResumeSchema } from "@/lib/resumeBuilder/schema";

interface LivePreviewProps {
  resume: ResumeSchema;
  templateId: string;
  layout: ResumeLayoutSettings;
  // No longer used for remounting (kept optional for callers that still pass
  // it) — see below for why this component stopped using react-pdf's
  // PDFViewer for the live/editing view.
  previewKey?: string;
  className?: string;
}

// Renders a plain-DOM mirror of the resume (DomResumeTemplate), not
// react-pdf's PDFViewer, while the candidate is actively editing.
//
// Root cause this works around: PDFViewer renders into an <iframe
// src="blob:...">, and every content change makes react-pdf regenerate the
// PDF blob and assign a brand-new object URL to that `src` (see
// @react-pdf/renderer's usePDF()/PDFViewer source). Reassigning an iframe's
// `src` always makes the browser reload that iframe's document — this is
// native browser behavior, not a React key/remount/state issue, so it can't
// be fixed by changing props, keys, or CSS on our side. The only way to get a
// genuinely flicker-free *live* preview is to not put an iframe in the
// render path at all while editing.
//
// DomResumeTemplate is a hand-mirrored HTML/CSS version of the same
// templates (same styles.ts-derived scale math, same section order/content),
// so it visually matches the real PDF. The actual PDFViewer/PDF generation
// is unchanged and still used for Generate & Save, Download, and the Version
// History preview modal — those render the exact real PDF on demand, where a
// one-time render is expected rather than something the candidate watches
// flicker on every keystroke.
export function LivePreview({ resume, templateId, layout, className = "" }: LivePreviewProps) {
  return (
    <div className={`h-full w-full overflow-auto bg-surface ${className}`}>
      <div className="mx-auto py-4">
        <DomResumeTemplate resume={{ ...resume, templateId, layout }} />
      </div>
    </div>
  );
}
