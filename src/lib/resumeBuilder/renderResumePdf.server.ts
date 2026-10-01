// SERVER-ONLY: @react-pdf/renderer's Node entry needs Buffer/stream.
// Replaces the old pdfRenderer.server.ts (PDFKit) — this renders the exact
// same React component tree the browser preview uses (see templates/registry.ts),
// so the downloaded PDF and the live preview can never drift apart again.
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";
import type { ResumeSchema } from "./schema";
import { getResumeTemplate } from "./templates/registry";

export async function renderResumeToPdf(resume: ResumeSchema): Promise<Buffer> {
  const Template = getResumeTemplate(resume.templateId);
  // Every template component's root is a <Document>, satisfying DocumentProps
  // at runtime — renderToBuffer's generic just can't see that through the
  // shared ResumeTemplateComponent signature.
  const element = createElement(Template, { resume }) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(element);
}
