import { getResumeTemplate } from "@/lib/resumeBuilder/templates/registry";
import type { ResumeLayoutSettings, ResumeSchema } from "@/lib/resumeBuilder/schema";
import { PDFViewer } from "@react-pdf/renderer";

interface LivePreviewProps {
  resume: ResumeSchema;
  templateId: string;
  layout: ResumeLayoutSettings;
  // Forces the inner PDFViewer to remount when the template/section set changes
  // (react-pdf duplicates reordered siblings on incremental updates otherwise).
  // Named distinctly from `key` since React reserves that prop name and strips
  // it before it reaches this component.
  previewKey?: string;
  className?: string;
}

export function LivePreview({
  resume,
  templateId,
  layout,
  previewKey,
  className = "",
}: LivePreviewProps) {
  const Template = getResumeTemplate(templateId);

  return (
    <PDFViewer
      key={previewKey}
      style={{ width: "100%", height: "100%", border: "none" }}
      showToolbar={false}
      className={className}
    >
      <Template resume={{ ...resume, templateId, layout }} />
    </PDFViewer>
  );
}
