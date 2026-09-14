# Prompt for Claude Code: Redesign alert email templates (premium look)

Paste the block below into Claude Code in your project root
(`C:\Users\user\Desktop\jobskart`).

---

```
The job-alert emails work correctly now (confirmed end-to-end via a
real "New match found" email received), but the current template looks
very bare-bones — plain text-like layout, no logo, weak visual
hierarchy, no clear call-to-action button, no footer. Redesign both
alert email templates to feel premium/polished, like a well-designed
modern SaaS product's transactional emails.

IMPORTANT — email HTML constraints (different from web CSS):
Email clients (Gmail, Outlook, Apple Mail, etc.) have very limited and
inconsistent CSS support compared to browsers. To render correctly and
consistently:
- Use TABLE-BASED layout (nested <table> elements), not flexbox/grid —
  most email clients don't support modern CSS layout.
- Use INLINE styles on every element (style="..." attributes), not
  <style> blocks or external stylesheets — many clients strip these.
- Keep the overall email width around 600px (standard email width).
- Use web-safe fonts with fallbacks (e.g. Arial, Helvetica, sans-serif)
  — don't rely on custom fonts loading, though a fallback font stack
  matching the app's brand font is fine if it degrades gracefully.
- Avoid CSS features unlikely to be supported (box-shadow, gradients,
  flexbox, grid, custom properties/CSS variables) — stick to
  well-supported basics: background-color, padding, border, border-radius
  (widely supported now), font styles, text-align.
- Test that it would look reasonable even with images blocked by
  default (common in email clients) — don't rely on a background image
  or logo image alone to carry critical information.
- Include a plain-text fallback version alongside the HTML version if
  the current Resend integration doesn't already send one (Resend's API
  accepts both `html` and `text` fields).

Design goals for both templates:

1. "Alert created" confirmation email:
   - Clear JobsKart branding at the top (logo if feasible as an image
     with a reasonable fallback, or a clean text-based wordmark styled
     to match the app's brand color)
   - Warm, clear confirmation message: what the alert is watching for
     (keyword + city if set), and what frequency they chose
   - A clear, well-styled button/link to manage their alerts (linking
     to /candidate/alerts)
   - A simple, professional footer (company name, maybe an unsubscribe/
     manage-preferences link if that's feasible given what data the
     function has access to)

2. "New match found" email:
   - Same branding/header treatment as the confirmation email for
     consistency
   - Clear "New match for your alert: [keyword]" messaging
   - The matching job shown as a well-designed card: job title
     (prominent), company name, location, salary, and any other key
     details already being pulled in (check the current template/
     function for what data is already available — don't invent fields
     that aren't there)
   - A prominent, clearly-styled CALL-TO-ACTION BUTTON (not just a
     plain text link) that goes directly to the job's detail page —
     this was missing/unclear in the current version and is the single
     most important element of this email
   - If multiple jobs matched in one digest (for daily/weekly
     frequency alerts), design for a reasonably clean list of multiple
     job cards, not just a single one — check if the current
     implementation already supports batching multiple jobs into one
     email or only ever sends one job per email, and let me know either
     way
   - Footer consistent with the confirmation email

Use JobsKart's actual brand color (the blue used throughout the app —
check the design tokens/design.md if available) for accents/buttons
rather than inventing an unrelated color scheme.

Tell me:
- Where these templates live in the codebase now (which Edge
  Function(s)) and confirm both were updated
- Whether multi-job digest emails are already supported or only
  single-job — and if only single, whether that's worth fixing now or
  is fine for a first version
- Any email field/data you wanted to include but wasn't available in
  the current job/alert data being passed into the function
```
