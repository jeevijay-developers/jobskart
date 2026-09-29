// src/lib/resumeBuilder/pdfRenderer.ts
import { resumeTemplates } from './template';
import type { ResumeSchema, ExperienceItem, EducationItem, CertificationItem, LinkItem } from './schema';
import PDFKit from 'pdfkit';
import { Readable } from 'stream';

/**
 * Render a resume schema to PDF buffer using PDFKit.
 * This function creates a simple PDF with text sections.
 */
export async function renderResumeToPdf(resume: ResumeSchema): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const doc = new PDFKit({ autoFirstPage: false });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);

    // Add a page
    doc.addPage({ margin: 50 });
    doc.fontSize(12);

    // Helper to add text with line break
    const addLine = (text: string) => {
      doc.text(text, { continued: false });
      doc.moveDown(0.2);
    };

    // Title
    doc.fontSize(20).text(resume.title, { align: 'center' });
    doc.moveDown(0.5);

    // Iterate sections
    for (const section of resume.sections) {
      // Section title
      doc.fontSize(16).text(section.title.toUpperCase(), { underline: true });
      doc.moveDown(0.2);

      // Render content based on kind
      const content = section.content;
      switch (content.kind) {
        case 'text':
          addLine((content as { value: string }).value);
          break;
        case 'list':
          const items = (content as { items: string[] }).items;
          for (const item of items) {
            doc.text(`• ${item}`);
          }
          doc.moveDown(0.2);
          break;
        case 'experience':
          const expItems = (content as { items: ExperienceItem[] }).items;
          for (const exp of expItems) {
            doc.fontSize(12).text(`${exp.position} at ${exp.company}`, { continued: false });
            doc.text(`${exp.location ?? ''} | ${exp.startDate} – ${exp.endDate ?? ''}`);
            if (exp.description) addLine(exp.description);
            if (exp.achievements && exp.achievements.length) {
              for (const h of exp.achievements) {
                doc.text(`• ${h}`);
              }
            }
            doc.moveDown(0.3);
          }
          break;
        case 'education':
          const eduItems = (content as { items: EducationItem[] }).items;
          for (const edu of eduItems) {
            doc.fontSize(12).text(`${edu.degree} in ${edu.fieldOfStudy ?? ''}`, { continued: false });
            doc.text(`${edu.institution}, ${edu.location ?? ''} | ${edu.startDate ?? ''} – ${edu.endDate ?? ''}`);
            if (edu.description) addLine(edu.description);
            doc.moveDown(0.3);
          }
          break;
        case 'certification':
          const certItems = (content as { items: CertificationItem[] }).items;
          for (const cert of certItems) {
            doc.text(`${cert.name} - ${cert.issuingOrganization ?? ''}`);
            if (cert.issueDate) doc.text(`Issued: ${cert.issueDate}`);
            if (cert.expirationDate) doc.text(`Expires: ${cert.expirationDate}`);
            if (cert.credentialId) doc.text(`ID: ${cert.credentialId}`);
            doc.moveDown(0.2);
          }
          break;
        case 'link':
          const linkItems = (content as { items: LinkItem[] }).items;
          for (const link of linkItems) {
            doc.text(`${link.label}: ${link.url}`, { link: link.url });
          }
          doc.moveDown(0.2);
          break;
        default:
          // fallback
          addLine(JSON.stringify(content));
          break;
      }

      doc.moveDown(0.3);
    }

    doc.end();
  });
}

/**
 * Render a resume schema to HTML string (for preview).
 */
export function renderResumeToHtml(resume: ResumeSchema): string {
  const template = resumeTemplates[resume.templateId] ?? resumeTemplates['classic-ats'];
  return template.render(resume);
}