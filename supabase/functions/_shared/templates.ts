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

function formatIst(iso: string): string {
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
  const timePart = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return datePart + " \u00b7 " + timePart + " IST";
}

// ---------------------------------------------------------------------------
// Shared layout shell
// Brand colours (design tokens from styles.css):
//   Primary blue  : #1A55BD   Primary dark: #1340A0
//   Light blue bg : #EEF3FF   Body bg     : #F4F6FB
//   Text primary  : #111827   Text muted  : #6B7280
//   Border        : #E5E7EB   Card bg     : #FFFFFF
// ---------------------------------------------------------------------------
function layout(
  preheader: string,
  bodyHtml: string,
  opts?: { eyebrow?: string; footerHtml?: string },
): string {
  const appUrl = getPublicAppUrl();
  const eyebrow = opts?.eyebrow ?? "Job Alerts";
  const footerHtml =
    opts?.footerHtml ??
    "You're receiving this because you created a job alert on JobsKart.<br>\n" +
      '            <a href="' +
      appUrl +
      '/candidate/alerts" style="color:#1A55BD;text-decoration:none;">Manage or delete your alerts</a>';
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
    '  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F4F6FB;">' +
    escapeHtml(preheader) +
    "&nbsp;</div>\n" +
    '  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F6FB;">\n' +
    '    <tr><td align="center" style="padding:32px 16px 48px;">\n' +
    '      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:16px;overflow:hidden;">\n' +
    "        <!-- header -->\n" +
    '        <tr><td style="background-color:#1A55BD;padding:24px 32px;">\n' +
    '          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>\n' +
    '            <td><span style="font-size:22px;font-weight:700;color:#FFFFFF;letter-spacing:-0.3px;">Jobs<span style="color:#93C5FD;">Kart</span></span></td>\n' +
    '            <td align="right"><span style="font-size:12px;color:#BFDBFE;letter-spacing:0.04em;text-transform:uppercase;">' +
    escapeHtml(eyebrow) +
    "</span></td>\n" +
    "          </tr></table>\n" +
    "        </td></tr>\n" +
    "        <!-- body -->\n" +
    '        <tr><td style="padding:36px 32px 28px;">' +
    bodyHtml +
    "</td></tr>\n" +
    "        <!-- footer -->\n" +
    '        <tr><td style="background-color:#F9FAFB;border-top:1px solid #E5E7EB;padding:20px 32px;">\n' +
    '          <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.6;">\n' +
    "            " +
    footerHtml +
    "\n" +
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
export function alertConfirmationEmail(alert: AlertSummary): {
  subject: string;
  html: string;
  text: string;
} {
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
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    rows +
    "</table>" +
    "</td></tr></table>" +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">' +
    '<tr><td style="background-color:#1A55BD;border-radius:8px;">' +
    '<a href="' +
    appUrl +
    '/candidate/alerts" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">Manage my alerts &rarr;</a>' +
    "</td></tr></table>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EEF3FF;border-radius:10px;">' +
    '<tr><td style="padding:16px 20px;font-size:13px;color:#1A55BD;line-height:1.6;">' +
    "<strong>&#128161; Tip:</strong> You can create multiple alerts for different keywords or cities \u2014 we'll notify you separately for each." +
    "</td></tr></table>";

  const html = layout("We'll notify you when we find jobs matching \"" + watching + '".', body);

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
    '<tr><td style="padding-bottom:6px;"><a href="' +
    url +
    '" style="font-size:17px;font-weight:700;color:#111827;text-decoration:none;line-height:1.3;">' +
    escapeHtml(job.title) +
    "</a></td></tr>" +
    '<tr><td style="padding-bottom:16px;"><span style="font-size:13px;color:#6B7280;">' +
    meta +
    "</span></td></tr>" +
    "<tr><td>" +
    '<a href="' +
    url +
    '" style="display:inline-block;background-color:#1A55BD;border-radius:7px;padding:10px 22px;font-size:13px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">View Job &rarr;</a>' +
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
    : "New job match: " + jobs[0].title + " \u2014 apply now";

  const headingText = isDigest ? jobs.length + " new matches found" : "New job match!";
  const subText = isDigest
    ? "We found <strong>" +
      jobs.length +
      " new jobs</strong> matching your alert for <strong>" +
      escapeHtml(watching) +
      "</strong>. Apply while they're fresh."
    : "We found a new job matching your alert for <strong>" + escapeHtml(watching) + "</strong>.";

  const body =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">' +
    "<tr>" +
    '<td style="width:48px;vertical-align:top;padding-right:14px;">' +
    '<div style="width:48px;height:48px;background-color:#EEF3FF;border-radius:12px;text-align:center;line-height:48px;font-size:22px;">' +
    (isDigest ? "&#128203;" : "&#10024;") +
    "</div>" +
    "</td>" +
    '<td style="vertical-align:middle;">' +
    '<h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111827;line-height:1.2;">' +
    escapeHtml(headingText) +
    "</h1>" +
    '<p style="margin:0;font-size:14px;color:#6B7280;line-height:1.5;">' +
    subText +
    "</p>" +
    "</td></tr></table>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">' +
    '<tr><td style="height:1px;background-color:#E5E7EB;font-size:0;line-height:0;">&nbsp;</td></tr></table>' +
    jobs.map(jobCard).join("") +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;">' +
    '<tr><td style="padding:16px 24px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="font-size:13px;color:#6B7280;vertical-align:middle;">Looking for more? Browse all open roles.</td>' +
    '<td align="right" style="vertical-align:middle;"><a href="' +
    appUrl +
    '/jobs" style="font-size:13px;font-weight:600;color:#1A55BD;text-decoration:none;">Browse jobs &rarr;</a></td>' +
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

// ---------------------------------------------------------------------------
// Template 3 -- Application status change (shortlisted / interview / rejected)
// ---------------------------------------------------------------------------
export type ApplicationStatusNotifyStatus = "shortlisted" | "interview" | "rejected";

export type ApplicationStatusInfo = {
  status: ApplicationStatusNotifyStatus;
  candidateName: string | null;
  jobTitle: string;
  companyName: string | null;
};

const APPLICATION_STATUS_COPY: Record<
  ApplicationStatusNotifyStatus,
  {
    icon: string;
    heading: string;
    subtext: (jobTitle: string, companyName: string) => string;
    ctaLabel: string;
    ctaPath: string;
    preheader: (jobTitle: string) => string;
    subjectPrefix: string;
  }
> = {
  shortlisted: {
    icon: "&#11088;",
    heading: "You've been shortlisted!",
    subtext: (jobTitle, companyName) =>
      companyName +
      " shortlisted you for <strong>" +
      jobTitle +
      "</strong>. Keep an eye on your inbox \u2014 they may reach out with next steps soon.",
    ctaLabel: "View my applications &rarr;",
    ctaPath: "/candidate/applications",
    preheader: (jobTitle) => "You've been shortlisted for " + jobTitle + ".",
    subjectPrefix: "You've been shortlisted for ",
  },
  interview: {
    icon: "&#128197;",
    heading: "You're moving to interview!",
    subtext: (jobTitle, companyName) =>
      companyName +
      " wants to interview you for <strong>" +
      jobTitle +
      "</strong>. They'll be in touch with next steps soon.",
    ctaLabel: "View my applications &rarr;",
    ctaPath: "/candidate/applications",
    preheader: (jobTitle) => "You're being considered for an interview for " + jobTitle + ".",
    subjectPrefix: "Interview stage: ",
  },
  rejected: {
    icon: "&#128172;",
    heading: "Update on your application",
    subtext: (jobTitle, companyName) =>
      companyName +
      " has decided not to move forward with your application for <strong>" +
      jobTitle +
      "</strong> at this time. Don't be discouraged \u2014 new roles are posted every day.",
    ctaLabel: "Browse more jobs &rarr;",
    ctaPath: "/jobs",
    preheader: (jobTitle) => "An update on your application for " + jobTitle + ".",
    subjectPrefix: "Update on your application: ",
  },
};

export function applicationStatusEmail(info: ApplicationStatusInfo): {
  subject: string;
  html: string;
  text: string;
} {
  const appUrl = getPublicAppUrl();
  const copy = APPLICATION_STATUS_COPY[info.status];
  const companyName = escapeHtml(info.companyName || "The employer");
  const jobTitle = escapeHtml(info.jobTitle);
  const greetingName = info.candidateName ? escapeHtml(info.candidateName.split(" ")[0]) : "there";
  const url = appUrl + copy.ctaPath;
  const subject = copy.subjectPrefix + info.jobTitle;

  const body =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">' +
    "<tr>" +
    '<td style="width:48px;vertical-align:top;padding-right:14px;">' +
    '<div style="width:48px;height:48px;background-color:#EEF3FF;border-radius:12px;text-align:center;line-height:48px;font-size:22px;">' +
    copy.icon +
    "</div>" +
    "</td>" +
    '<td style="vertical-align:middle;">' +
    '<h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111827;line-height:1.2;">' +
    escapeHtml(copy.heading) +
    "</h1>" +
    '<p style="margin:0;font-size:14px;color:#6B7280;">Hi ' +
    greetingName +
    ",</p>" +
    "</td></tr></table>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;margin-bottom:28px;">' +
    '<tr><td style="padding:20px 24px;">' +
    '<p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9CA3AF;">' +
    jobTitle +
    "</p>" +
    '<p style="margin:0;font-size:14px;color:#111827;line-height:1.6;">' +
    copy.subtext(jobTitle, companyName) +
    "</p>" +
    "</td></tr></table>" +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">' +
    '<tr><td style="background-color:#1A55BD;border-radius:8px;">' +
    '<a href="' +
    url +
    '" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">' +
    copy.ctaLabel +
    "</a>" +
    "</td></tr></table>";

  const html = layout(copy.preheader(info.jobTitle), body, {
    eyebrow: "Application Update",
    footerHtml:
      "You're receiving this because an employer updated the status of your application on JobsKart.<br>\n" +
      '            <a href="' +
      appUrl +
      '/candidate/applications" style="color:#1A55BD;text-decoration:none;">View your applications</a>',
  });

  const text = [
    "JobsKart \u2014 " + copy.heading,
    "",
    "Hi " + greetingName + ",",
    "",
    (info.companyName || "The employer") + " \u2014 " + info.jobTitle,
    "",
    copy.ctaLabel.replace(" &rarr;", "") + ": " + url,
    "\u2014",
    "JobsKart \u00b7 " + appUrl,
  ].join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Template 4 -- Interview scheduled (Email 1: no join link/password, sent
// immediately after scheduling). The join link is deliberately withheld here
// regardless of provider (Zoom or external) \u2014 it's sent 30 minutes before via
// interviewReminderEmail so it can't sit in an inbox unused for days. See
// Bottleneck 2.6 / the anti-fraud gating notes in INTERVIEW_FEATURE_IMPLEMENTATION_PLAN.md.
// ---------------------------------------------------------------------------
export type InterviewScheduledInfo = {
  candidateName: string | null;
  jobTitle: string;
  companyName: string | null;
  scheduledAtIso: string;
  durationMin: number;
  mode: "video" | "phone" | "onsite";
};

const MODE_LABEL: Record<InterviewScheduledInfo["mode"], string> = {
  video: "Video call",
  phone: "Phone call",
  onsite: "In person",
};

export function interviewScheduledEmail(info: InterviewScheduledInfo): {
  subject: string;
  html: string;
  text: string;
} {
  const appUrl = getPublicAppUrl();
  const companyName = escapeHtml(info.companyName || "The employer");
  const jobTitle = escapeHtml(info.jobTitle);
  const greetingName = info.candidateName ? escapeHtml(info.candidateName.split(" ")[0]) : "there";
  const when = formatIst(info.scheduledAtIso);
  const url = appUrl + "/candidate/applications";
  const subject = "Interview scheduled: " + info.jobTitle;

  const rows =
    '<tr><td style="font-size:13px;color:#6B7280;padding-bottom:8px;width:120px;">Date &amp; time</td>' +
    '<td style="font-size:13px;font-weight:600;color:#111827;padding-bottom:8px;">' +
    escapeHtml(when) +
    "</td></tr>" +
    '<tr><td style="font-size:13px;color:#6B7280;padding-bottom:8px;">Duration</td>' +
    '<td style="font-size:13px;font-weight:600;color:#111827;padding-bottom:8px;">' +
    info.durationMin +
    " min</td></tr>" +
    '<tr><td style="font-size:13px;color:#6B7280;">Format</td>' +
    '<td style="font-size:13px;font-weight:600;color:#111827;">' +
    MODE_LABEL[info.mode] +
    "</td></tr>";

  const body =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">' +
    "<tr>" +
    '<td style="width:48px;vertical-align:top;padding-right:14px;">' +
    '<div style="width:48px;height:48px;background-color:#EEF3FF;border-radius:12px;text-align:center;line-height:48px;font-size:22px;">&#128197;</div>' +
    "</td>" +
    '<td style="vertical-align:middle;">' +
    '<h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111827;line-height:1.2;">Interview scheduled!</h1>' +
    '<p style="margin:0;font-size:14px;color:#6B7280;">Hi ' +
    greetingName +
    ",</p>" +
    "</td></tr></table>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;margin-bottom:20px;">' +
    '<tr><td style="padding:20px 24px;">' +
    '<p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9CA3AF;">' +
    jobTitle +
    " \u00b7 " +
    companyName +
    "</p>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    rows +
    "</table>" +
    "</td></tr></table>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EEF3FF;border-radius:10px;margin-bottom:24px;">' +
    '<tr><td style="padding:16px 20px;font-size:13px;color:#1A55BD;line-height:1.6;">' +
    "<strong>&#128274; For your security,</strong> your direct interview join link will be sent to this email 30 minutes before the interview begins." +
    "</td></tr></table>" +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' +
    '<tr><td style="background-color:#1A55BD;border-radius:8px;">' +
    '<a href="' +
    url +
    '" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">View my applications &rarr;</a>' +
    "</td></tr></table>";

  const html = layout("Your interview for " + info.jobTitle + " is scheduled for " + when + ".", body, {
    eyebrow: "Interview",
    footerHtml:
      "You're receiving this because an employer scheduled an interview with you on JobsKart.<br>\n" +
      '            <a href="' +
      appUrl +
      '/candidate/applications" style="color:#1A55BD;text-decoration:none;">View your applications</a>',
  });

  const text = [
    "JobsKart \u2014 Interview scheduled",
    "",
    "Hi " + greetingName + ",",
    "",
    jobTitle + " \u00b7 " + companyName,
    "When: " + when,
    "Duration: " + info.durationMin + " min",
    "Format: " + MODE_LABEL[info.mode],
    "",
    "For your security, your direct interview join link will be sent to this email 30 minutes before the interview begins.",
    "",
    "View your applications: " + url,
    "\u2014",
    "JobsKart \u00b7 " + appUrl,
  ].join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Template 5 -- Interview reminder (Email 2: T-30 magic join link)
// ---------------------------------------------------------------------------
export type InterviewReminderInfo = {
  candidateName: string | null;
  jobTitle: string;
  companyName: string | null;
  scheduledAtIso: string;
  mode: "video" | "phone" | "onsite";
  joinUrl: string;
};

export function interviewReminderEmail(info: InterviewReminderInfo): {
  subject: string;
  html: string;
  text: string;
} {
  const appUrl = getPublicAppUrl();
  const companyName = escapeHtml(info.companyName || "The employer");
  const jobTitle = escapeHtml(info.jobTitle);
  const greetingName = info.candidateName ? escapeHtml(info.candidateName.split(" ")[0]) : "there";
  const when = formatIst(info.scheduledAtIso);
  const subject = "Starts in 30 min: " + info.jobTitle + " interview";
  const ctaLabel = info.mode === "video" ? "Join interview &rarr;" : "View interview details &rarr;";

  const body =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">' +
    "<tr>" +
    '<td style="width:48px;vertical-align:top;padding-right:14px;">' +
    '<div style="width:48px;height:48px;background-color:#FEF3C7;border-radius:12px;text-align:center;line-height:48px;font-size:22px;">&#9200;</div>' +
    "</td>" +
    '<td style="vertical-align:middle;">' +
    '<h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#111827;line-height:1.2;">Your interview starts in 30 minutes</h1>' +
    '<p style="margin:0;font-size:14px;color:#6B7280;">Hi ' +
    greetingName +
    ",</p>" +
    "</td></tr></table>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;margin-bottom:28px;">' +
    '<tr><td style="padding:20px 24px;">' +
    '<p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9CA3AF;">' +
    jobTitle +
    " \u00b7 " +
    companyName +
    "</p>" +
    '<p style="margin:0;font-size:14px;color:#111827;">' +
    escapeHtml(when) +
    "</p>" +
    "</td></tr></table>" +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">' +
    '<tr><td style="background-color:#1A55BD;border-radius:8px;">' +
    '<a href="' +
    info.joinUrl +
    '" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.01em;">' +
    ctaLabel +
    "</a>" +
    "</td></tr></table>";

  const html = layout("Your interview for " + info.jobTitle + " starts in 30 minutes.", body, {
    eyebrow: "Interview reminder",
    footerHtml:
      "You're receiving this because you have an interview scheduled on JobsKart.<br>\n" +
      '            <a href="' +
      appUrl +
      '/candidate/applications" style="color:#1A55BD;text-decoration:none;">View your applications</a>',
  });

  const text = [
    "JobsKart \u2014 Interview starts in 30 minutes",
    "",
    "Hi " + greetingName + ",",
    "",
    jobTitle + " \u00b7 " + companyName,
    "When: " + when,
    "",
    ctaLabel.replace(" &rarr;", "") + ": " + info.joinUrl,
    "\u2014",
    "JobsKart \u00b7 " + appUrl,
  ].join("\n");

  return { subject, html, text };
}
