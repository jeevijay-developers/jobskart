// src/lib/resumeBuilder/pdfRenderer.server.ts
// SERVER-ONLY: This module uses pdfkit which requires Node.js (Buffer, stream, fs).
// The .server.ts suffix ensures TanStack Router / Vite never includes this in the client bundle.
import type { ResumeSchema, ExperienceItem, EducationItem, CertificationItem, LinkItem } from './schema';
// pdfkit is loaded dynamically so it is never evaluated at module-load time —
// this prevents Vite's SSR module runner from trying to resolve it during startup.


/**
 * Render a resume schema to PDF buffer using PDFKit.
 * SERVER-ONLY — requires Node.js Buffer / stream APIs.
 */
export async function renderResumeToPdf(resume: ResumeSchema): Promise<Buffer> {
  // Dynamic import so pdfkit is only resolved when this function is actually called.
  const PDFKit = (await import('pdfkit')).default;

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const doc = new PDFKit({ autoFirstPage: false });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.addPage({ margin: 50 });
    doc.fontSize(12);

    const addLine = (text: string) => {
      doc.text(text, { continued: false });
      doc.moveDown(0.2);
    };

    doc.fontSize(20).text(resume.title, { align: 'center' });
    doc.moveDown(0.5);

    for (const section of resume.sections) {
      doc.fontSize(16).text(section.title.toUpperCase(), { underline: true });
      doc.moveDown(0.2);

      const content = section.content;
      switch (content.kind) {
        case 'text':
          addLine((content as { value: string }).value);
          break;
        case 'list':
          for (const item of (content as { items: string[] }).items) {
            doc.text(`• ${item}`);
          }
          doc.moveDown(0.2);
          break;
        case 'experience':
          for (const exp of (content as { items: ExperienceItem[] }).items) {
            doc.fontSize(12).text(`${exp.position} at ${exp.company}`, { continued: false });
            doc.text(`${exp.location ?? ''} | ${exp.startDate} – ${exp.endDate ?? ''}`);
            if (exp.description) addLine(exp.description);
            if (exp.achievements?.length) {
              for (const h of exp.achievements) doc.text(`• ${h}`);
            }
            doc.moveDown(0.3);
          }
          break;
        case 'education':
          for (const edu of (content as { items: EducationItem[] }).items) {
            doc.fontSize(12).text(`${edu.degree} in ${edu.fieldOfStudy ?? ''}`, { continued: false });
            doc.text(`${edu.institution}, ${edu.location ?? ''} | ${edu.startDate ?? ''} – ${edu.endDate ?? ''}`);
            if (edu.description) addLine(edu.description);
            doc.moveDown(0.3);
          }
          break;
        case 'certification':
          for (const cert of (content as { items: CertificationItem[] }).items) {
            doc.text(`${cert.name} - ${cert.issuingOrganization ?? ''}`);
            if (cert.issueDate) doc.text(`Issued: ${cert.issueDate}`);
            if (cert.expirationDate) doc.text(`Expires: ${cert.expirationDate}`);
            if (cert.credentialId) doc.text(`ID: ${cert.credentialId}`);
            doc.moveDown(0.2);
          }
          break;
        case 'link':
          for (const link of (content as { items: LinkItem[] }).items) {
            doc.text(`${link.label}: ${link.url}`, { link: link.url });
          }
          doc.moveDown(0.2);
          break;
        default:
          addLine(JSON.stringify(content));
          break;
      }
      doc.moveDown(0.3);
    }

    doc.end();
  });
}

