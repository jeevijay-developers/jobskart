// src/lib/resumeBuilder/template.ts
export interface ResumeTemplate {
  id: string;
  name: string;
  // A function that renders resume schema to HTML string
  render: (resume: any) => string;
}

// Simple classic ATS template
export const classicAtsTemplate: ResumeTemplate = {
  id: 'classic-ats',
  name: 'Classic ATS',
  render: (resume: any) => {
    // In real implementation, use a proper templating engine (e.g., Handlebars)
    // Here we produce a minimal HTML for demonstration
    const sectionsHtml = resume.sections.map(sec => {
      let inner = '';
      switch (sec.type) {
        case 'summary':
          inner = `<p>${(sec.content as {kind:'text';value:string}).value}</p>`;
          break;
        case 'skills':
          const skills = (sec.content as {kind:'list';items:string[]}).items.join(', ');
          inner = `<p>${skills}</p>`;
          break;
        case 'experience':
          const expItems = (sec.content as {kind:'experience';items:any[]}).items;
          inner = expItems.map(exp => `
            <div class="experience-item">
              <h3>${exp.position} at ${exp.company}</h3>
              <p class="date-range">${exp.startDate} ${exp.endDate ? '–' + exp.endDate : 'Present'}</p>
              ${exp.location ? `<p class="location">${exp.location}</p>` : ''}
              ${exp.description ? `<p>${exp.description}</p>` : ''}
              ${exp.achievements && exp.achievements.length > 0 ? `<ul>${exp.achievements.map(a => `<li>${a}</li>`).join('')}</ul>` : ''}
            </div>
          `).join('');
          break;
        case 'education':
          const eduItems = (sec.content as {kind:'education';items:any[]}).items;
          inner = eduItems.map(edu => `
            <div class="education-item">
              <h3>${edu.degree} in ${edu.fieldOfStudy || ''}</h3>
              <p class="institution">${edu.institution}</p>
              <p class="date-range">${edu.startDate ?? ''} ${edu.endDate ? '–' + edu.endDate : ''}</p>
              ${edu.location ? `<p class="location">${edu.location}</p>` : ''}
              ${edu.description ? `<p>${edu.description}</p>` : ''}
            </div>
          `).join('');
          break;
        case 'certifications':
          const certItems = (sec.content as {kind:'certification';items:any[]}).items;
          inner = certItems.map(cert => `
            <div class="certification-item">
              <h3>${cert.name}</h3>
              ${cert.issuingOrganization ? `<p>${cert.issuingOrganization}</p>` : ''}
              ${cert.issueDate ? `<p>Issued: ${cert.issueDate}</p>` : ''}
              ${cert.expirationDate ? `<p>Expires: ${cert.expirationDate}</p>` : ''}
            </div>
          `).join('');
          break;
        case 'languages':
          const langs = (sec.content as {kind:'list';items:string[]}).items.join(', ');
          inner = `<p>${langs}</p>`;
          break;
        case 'links':
          const linkItems = (sec.content as {kind:'link';items:any[]}).items;
          inner = linkItems.map(link => `<p><a href="${link.url}" target="_blank" rel="noopener">${link.label}</a></p>`).join('');
          break;
        case 'custom':
          inner = `<p>${(sec.content as {kind:'text';value:string}).value}</p>`;
          break;
        default:
          inner = '';
      }
      return `<section><h2>${sec.title}</h2>${inner}</section>`;
    }).join('');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>${resume.title}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; margin: 40px; color: #333; }
          h1, h2, h3 { color: #2c3e50; }
          .experience-item, .education-item, .certification-item { margin-bottom: 1em; }
          .date-range { font-size: 0.9em; color: #555; }
          .location { font-size: 0.9em; color: #777; margin-top: 0.2em; }
          a { color: #1a73e8; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <h1>${resume.title}</h1>
        ${sectionsHtml}
      </body>
      </html>
    `;
  },
};

// Template registry
export const resumeTemplates: Record<string, ResumeTemplate> = {
  [classicAtsTemplate.id]: classicAtsTemplate,
};

/**
 * Render a resume schema to HTML string for browser preview.
 * Browser-safe: no Node.js APIs used.
 */
export function renderResumeToHtml(resume: { templateId: string; title: string; sections: any[] }): string {
  const template = resumeTemplates[resume.templateId] ?? resumeTemplates['classic-ats'];
  return template.render(resume);
}