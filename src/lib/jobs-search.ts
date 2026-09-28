import { z } from "zod";

export const jobsSearchSchema = z.object({
  q: z.string().optional(),
  city: z.string().optional(),
  category: z.string().optional(),
  jobType: z.string().optional(),
  workMode: z.string().optional(),
  minSalary: z.string().optional(),
  maxSalary: z.string().optional(),
  minExp: z.string().optional(),
  maxExp: z.string().optional(),
  datePosted: z.string().optional(),
  education: z.string().optional(),
  shift: z.string().optional(),
  englishLevel: z.string().optional(),
  company: z.string().optional(),
  vehicle: z.string().optional(),
  verifiedOnly: z.string().optional(),
  sort: z.enum(["recommended", "newest", "oldest", "salary_high", "salary_low"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export type JobsSearch = z.infer<typeof jobsSearchSchema>;
