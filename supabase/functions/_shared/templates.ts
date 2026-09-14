import { getPublicAppUrl } from "./resend.ts";

// Mirrors src/lib/format.ts formatSalary -- duplicated for Deno runtime isolation.
function formatSalary(min: number | null, max: number | null, period = "monthly"): string {
  if (!min && !max) return "Not disclosed";
  const fmt = (n: number) => {
    if (n >= 100000) return "\u20b9" + (n / 100000).toFixed(n % 100000 === 0 ? 0 : 1) + " L";
    if (n >= 1000) return "\u20b9" + Math.round(n / 1000) + "k";
    return "\u20b9" + n;
  };
  const suffix = period === "monthly" ? "/mo" : period === "yearly" ? "/yr" : "";
  if (min && max && min !== max) return fmt(min) + " \u2013 " + fmt(max) + suffix;
  return fmt(min || max || 0) + suffix;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function frequencyLabel(f: string): string {
  if (f === "instant") return "Instant \u2014 as jobs are posted";
  if (f === "daily") return "Daily digest";
  if (f === "weekly") return "Weekly digest";
  return f;
}

// ---------------------------------------------------------------------------
// Shared layout shell
// Brand colours (design tokens from styles.css):
//   Primary blue  : #1A55BD   Primary dark: #1340A0
//   Light blue bg : #EEF3FF   Body bg     : #F4F6FB
//   Text primary  : #111827   Text muted  : #6B7280
//   Border        : #E5E7EB   Card bg     : #FFFFFF
// ---------------------------------------------------------------------------
function layout(preheader: string, bodyHtml: string): string {
  const appUrl = getPublicAppUrl();
  return (
    "<!doctype html>\n" +
    '<html lang="en">\n' +
    "<head>\n" +
    '  <meta charset="UTF-8">\n' +
    '  <meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '  <meta http-equiv="X-UA-Compatible" content="IE=edge">\n' +
    "  <title>JobsKart</title>\n" +
    "</head>\n" +
    '<body style="margin:0;padding:0;background-color:#F4F6FB;font-family:Arial,Helvetica,sans-serif;color:#111827;-webkit-text-size-adjust:100%;mso-line-height-rule:exactly;">\n' +
    '  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F4F6FB;">' + escapeHtml(preheader) + "&nbsp;</div>\n" +
    '  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F6FB;">\n' +
    '    <tr><td align="center" style="padding:32px 16px 48px;">\n' +
    '      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:16px;overflow:hidden;">\n' +
    "        <!-- header -->\n" +
    '        <tr><td style="background-color:#1A55BD;padding:24px 32px;">\n' +
    '          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>\n' +
    '            <td><span style="font-size:22px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px;">Jobs<span style="color:#93C5FD;">Kart</span></span></td>\n' +
    '            <td align="right"><span style="font-size:12px;color:#BFDBFE;letter-spacing:0.04em;text-transform:uppercase;">Job Alerts</span></td>\n' +
    "          </tr></table>\n" +
    "        </td></tr>\n" +
    "        <!-- body -->\n" +
    '        <tr><td style="padding:36px 32px 28px;">' + bodyHtml + "</td></tr>\n" +
    "        <!-- footer -->\n" +
    '        <tr><td style="background-color:#F9FAFB;border-top:1px solid #E5E7EB;padding:20px 32px;">\n' +
    '          <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.6;">\n' +
    "            You're receiving this because you created a job alert on JobsKart.<br>\n" +
    '            <a href="' + appUrl + '/candidate/alerts" style="color:#1A55BD;text-decoration:none;">Manage or delete your alerts</a>\n' +
    "          </p>\n" +
    "        </td></tr>\n" +
    "      </table>\n" +
    "    </td></tr>\n" +
    "  </table>\n" +
    "</body></html>"
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type AlertSummary = { keyword?: string | null; city?: string | null; frequency: string };

export type MatchedJob = {
  id: string;
  title: string;
  city: string | null;
  min_salary: number | null;
  max_salary: number | null;
  salary_period: string | null;
  company_name: string | null;
};

// ---------------------------------------------------------------------------
// Template 1 -- Alert confirmation
// ---------------------------------------------------------------------------
export function alertConfirmationEmail(
  alert: AlertSummary,
): { subject: string; html: string; text: string } {
  const appUrl = getPublicAppUrl();
  const watching = [alert.keyword, alert.city].filter(Boolean).join(" \u00b7 ") || "new jobs";
  const subject = 'Your job alert is active \u2014 "' + watching + '"';

  const rows =
    (alert.keyword
      ? '<tr><td style="font-size:13px;color:#6B7280;padding-bottom:8px;width:120px;">Keyword</td>' +
        '<td style="font-size:13px;font-weight:600;color:#111827;padding-bottom:8px;">' +
        escapeHtml(alert.keyword) +
        "</td></tr>"
      : "") +
    (alert.city
      ? '<tr><td style="font-size:13px;color:#6B7280;padding-bottom:8px;">Location</td>' +
        '<td style="font-size:13px;font-weight:600;color:#111827;padding-bottom:8px;">' +
        escapeHtml(alert.city) +
        "</td></tr>"
      : "") +
    '<tr><td style="font-size:13px;color:#6B7280;">Frequency</td>' +
    '<td style="font-size:13px;font-weight:600;color:#111827;">' +
    escapeHtml(frequencyLabel(alert.frequency)) +
    "</td></tr>";

  const body =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">' +
    "<tr>" +
    '<td style="width:48px;vertical-align:top;padding-right:14px;">' +
    '<div style="width:48px;height:48px;background-color:#EEF3FF;border-radius:12px;text-align:center;line-height:48px;font-size:22px;">&#128276;</div>' +
    "</td>" +
    '<td style="vertical-align:middle;">' +
    '<h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111827;line-height:1.2;">Alert created!</h1>' +
    '<p style="margin:0;font-size:14px;color:#6B7280;">We\'re now watching for your next opportunity.</p>' +
    "</td></tr></table>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;margin-bottom:28px;">' +
    '<tr><td style="padding:20px 24px;">' +
    '<p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9CA3AF;">Your alert details</p>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + rows + "</table>" +
    "</td></tr></table>" +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">' +
    '<tr><td style="background-color:#1A55BD;border-radius:8px;">' +
    '<a href="' + appUrl + '/candidate/alerts" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">Manage my alerts &rarr;</a>' +
    "</td></tr></table>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EEF3FF;border-radius:10px;">' +
    '<tr><td style="padding:16px 20px;font-size:13px;color:#1A55BD;line-height:1.6;">' +
    "<strong>&#128161; Tip:</strong> You can create multiple alerts for different keywords or cities \u2014 we'll notify you separately for each." +
    "</td></tr></table>";

  const html = layout(
    'We\'ll notify you when we find jobs matching "' + watching + '".',
    body,
  );

  const text = [
    "JobsKart \u2014 Alert Created",
    "",
    "Your alert is active!",
    "Watching for: " + watching,
    "Frequency: " + frequencyLabel(alert.frequency),
    "",
    "We'll email you as soon as we find a matching job.",
    "",
    "Manage your alerts: " + appUrl + "/candidate/alerts",
    "\u2014",
    "JobsKart \u00b7 " + appUrl,
  ].join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Template 2 -- New job match(es)
// Multi-job digest is already supported: the digest function passes an array.
// The instant webhook currently sends one job per call; both cases are handled.
// ---------------------------------------------------------------------------
function jobCard(job: MatchedJob): string {
  const appUrl = getPublicAppUrl();
  const url = appUrl + "/jobs/" + job.id;
  const salary = formatSalary(job.min_salary, job.max_salary, job.salary_period || "monthly");
  const meta = [job.company_name, job.city, salary]
    .filter(Boolean)
    .map(escapeHtml)
    .join("&nbsp;&nbsp;&middot;&nbsp;&nbsp;");

  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;margin-bottom:12px;">' +
    '<tr><td style="padding:20px 24px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    '<tr><td style="padding-bottom:6px;"><a href="' + url + '" style="font-size:17px;font-weight:700;color:#111827;text-decoration:none;line-height:1.3;">' + escapeHtml(job.title) + "</a></td></tr>" +
    '<tr><td style="padding-bottom:16px;"><span style="font-size:13px;color:#6B7280;">' + meta + "</span></td></tr>" +
    "<tr><td>" +
    '<a href="' + url + '" style="display:inline-block;background-color:#1A55BD;border-radius:7px;padding:10px 22px;font-size:13px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">View Job &rarr;</a>' +
    "</td></tr>" +
    "</table></td></tr></table>"
  );
}

export function jobMatchEmail(
  alert: AlertSummary,
  jobs: MatchedJob[],
): { subject: string; html: string; text: string } {
  const appUrl = getPublicAppUrl();
  const watching = [alert.keyword, alert.city].filter(Boolean).join(" \u00b7 ") || "your alert";
  const isDigest = jobs.length > 1;

  const subject = isDigest
    ? jobs.length + ' new jobs match "' + watching + '" \u2014 apply before they close'
    : 'New job match: ' + jobs[0].title + " \u2014 apply now";

  const headingText = isDigest ? jobs.length + " new matches found" : "New job match!";
  const subText = isDigest
    ? "We found <strong>" + jobs.length + " new jobs</strong> matching your alert for <strong>" + escapeHtml(watching) + "</strong>. Apply while they're fresh."
    : "We found a new job matching your alert for <strong>" + escapeHtml(watching) + "</strong>.";

  const body =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">' +
    "<tr>" +
    '<td style="width:48px;vertical-align:top;padding-right:14px;">' +
    '<div style="width:48px;height:48px;background-color:#EEF3FF;border-radius:12px;text-align:center;line-height:48px;font-size:22px;">' + (isDigest ? "&#128203;" : "&#10024;") + "</div>" +
    "</td>" +
    '<td style="vertical-align:middle;">' +
    '<h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111827;line-height:1.2;">' + escapeHtml(headingText) + "</h1>" +
    '<p style="margin:0;font-size:14px;color:#6B7280;line-height:1.5;">' + subText + "</p>" +
    "</td></tr></table>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">' +
    '<tr><td style="height:1px;background-color:#E5E7EB;font-size:0;line-height:0;">&nbsp;</td></tr></table>' +
    jobs.map(jobCard).join("") +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;">' +
    '<tr><td style="padding:16px 24px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="font-size:13px;color:#6B7280;vertical-align:middle;">Looking for more? Browse all open roles.</td>' +
    '<td align="right" style="vertical-align:middle;"><a href="' + appUrl + '/jobs" style="font-size:13px;font-weight:600;color:#1A55BD;text-decoration:none;">Browse jobs &rarr;</a></td>' +
    "</tr></table></td></tr></table>";

  const html = layout(
    isDigest
      ? jobs.length + ' new jobs match your "' + watching + '" alert \u2014 apply now.'
      : '"' + jobs[0].title + '" matches your "' + watching + '" alert \u2014 apply now.',
    body,
  );

  const text = [
    "JobsKart \u2014 " + headingText,
    "",
    "Alert: " + watching,
    "",
    ...jobs.map((j) => {
      const url = appUrl + "/jobs/" + j.id;
      const salary = formatSalary(j.min_salary, j.max_salary, j.salary_period || "monthly");
      const meta = [j.company_name, j.city, salary].filter(Boolean).join(" \u00b7 ");
      return j.title + "\n" + meta + "\nApply: " + url;
    }),
    "",
    "Browse all jobs: " + appUrl + "/jobs",
    "Manage alerts: " + appUrl + "/candidate/alerts",
    "\u2014",
    "JobsKart \u00b7 " + appUrl,
  ].join("\n");

  return { subject, html, text };
}