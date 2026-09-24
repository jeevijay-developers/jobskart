// Optional tone-only AI polish over the deterministic JD from jd-template.ts.
// Hard rule (prompt structure/jd-engine.md §7): must not add responsibilities
// or change any number (salary, experience, openings, age). If the model
// output fails the numeric-guard check, or the call errors/times out, the
// original deterministic markdown ships unchanged — this must never block
// publishing.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { chat } from "@/lib/ai/provider";

const inputSchema = z.object({
  markdown: z.string().min(1),
  title: z.string(),
  minSalary: z.number().optional(),
  maxSalary: z.number().optional(),
  minExp: z.number().optional(),
  maxExp: z.number().optional(),
});

const TIMEOUT_MS = 3000;

function extractNumbers(s: string): string[] {
  return (s.match(/\d[\d,]*/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/** Every number present in the original must still be present in the
 *  polished text (order-independent) — this is what blocks a model from
 *  quietly changing ₹15,000 to ₹18,000 or 1-3 yrs to 2-4 yrs. */
function passesNumericGuard(original: string, polished: string): boolean {
  const origNums = new Set(extractNumbers(original));
  const polNums = new Set(extractNumbers(polished));
  for (const n of origNums) {
    if (!polNums.has(n)) return false;
  }
  return true;
}

export const polishJobDescription = createServerFn({ method: "POST" })
  .validator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const system = [
      "You rewrite job description text for tone and readability only.",
      "STRICT RULES:",
      "- Do not add, remove, or reorder any responsibility, requirement, or bullet point.",
      "- Do not change any number: salary figures, years of experience, openings, age range.",
      "- Do not invent new obligations, benefits, or claims not present in the input.",
      "- Preserve the markdown structure (headings, bullet lists) as-is.",
      "- Output only the rewritten markdown, nothing else.",
    ].join("\n");

    try {
      const result = await Promise.race([
        chat({ system, user: data.markdown, temperature: 0.3 }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
      ]);
      const polished = result.trim();
      if (!polished || !passesNumericGuard(data.markdown, polished)) {
        return { markdown: data.markdown, polished: false };
      }
      return { markdown: polished, polished: true };
    } catch {
      return { markdown: data.markdown, polished: false };
    }
  });
