export type ContactAudience = {
  helpline: string;
  helplineHours: string;
  email: string;
  whatsapp: string;
};

export type ContactSubjects = {
  job_seeker: string[];
  employer: string[];
};

export type ContactInfo = {
  heading: string;
  subheading: string;
  onlineNow: boolean;
  responseTime: string;
  hq: { company: string; address: string };
  jobSeeker: ContactAudience;
  employer: ContactAudience;
  subjects: ContactSubjects;
};

export const CONTACT_FALLBACK: ContactInfo = {
  heading: "We're Here to Help You Succeed",
  subheading:
    "Have questions about job search, employer hiring, or verification? Reach out to our dedicated support team.",
  onlineNow: true,
  responseTime: "Average response time: 2–3 hours across all support channels",
  hq: {
    company: "Test Technologies Pvt. Ltd.",
    address: "Test Tower, Sector 00, City, State - 000000",
  },
  jobSeeker: {
    helpline: "+91 90000 11111",
    helplineHours: "Mon – Sat, 9:30 AM – 7:00 PM IST",
    email: "support@test-jobskart.in",
    whatsapp: "+91 90000 33333",
  },
  employer: {
    helpline: "+91 90000 22222",
    helplineHours: "Mon – Sat, 10:00 AM – 8:00 PM IST",
    email: "employer@test-jobskart.in",
    whatsapp: "+91 90000 33333",
  },
  subjects: {
    job_seeker: ["Job application help", "Profile / resume", "Account & login", "Other"],
    employer: ["Post a job", "Candidate unlock & credits", "Company verification", "Other"],
  },
};
