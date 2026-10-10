// Candidate -> company contact helpers. The phone/email come from the contact the
// employer chose to share on the job (jobs.hiring_contact_*); nothing is hardcoded.

/** "98765 43210" / "+91 98765 43210" -> "919876543210" (wa.me wants digits only, with country code). */
export function whatsappDigits(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

export function whatsappUrl(phone: string, message: string): string | null {
  const digits = whatsappDigits(phone);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;
}

export function enquiryMessage(o: { companyName?: string | null; jobTitle?: string | null; candidateName?: string | null }): string {
  const who = o.candidateName ? `My name is ${o.candidateName}. ` : "";
  const about = o.jobTitle ? ` regarding the ${o.jobTitle} position` : "";
  return `Hello ${o.companyName || "team"}, ${who}I found you on JobsKart and would like to know more${about}. Could you please share more details?`;
}

export function followUpMessage(o: {
  companyName?: string | null;
  jobTitle?: string | null;
  appliedOn?: string | null;
  status?: string | null;
  candidateName?: string | null;
}): string {
  const who = o.candidateName ? `This is ${o.candidateName}. ` : "";
  const when = o.appliedOn ? ` on ${o.appliedOn}` : "";
  const status = o.status ? ` The status on JobsKart currently shows "${o.status}".` : "";
  return `Hello ${o.companyName || "team"}, ${who}I applied for the ${o.jobTitle || "position"} role${when} through JobsKart.${status} I wanted to follow up on my application. Could you please share an update?`;
}
