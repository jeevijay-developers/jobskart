// Groups of terms that mean the same skill. A job asking for "ML" counts a resume
// that says "machine learning", and the other way round. Entries are lowercase.
// Keep this list to unambiguous terms: a short alias that is also a common word
// would create false matches.
const SYNONYM_GROUPS: string[][] = [
  ["machine learning", "ml"],
  ["artificial intelligence", "ai"],
  ["javascript", "js"],
  ["typescript", "ts"],
  ["kubernetes", "k8s"],
  ["postgresql", "postgres"],
  ["amazon web services", "aws"],
  ["google cloud platform", "gcp"],
  ["continuous integration", "ci"],
  ["continuous delivery", "cd"],
  ["user interface", "ui"],
  ["user experience", "ux"],
  ["search engine optimization", "seo"],
  ["customer relationship management", "crm"],
  ["enterprise resource planning", "erp"],
  ["microsoft excel", "excel"],
  ["react.js", "react"],
  ["node.js", "nodejs"],
  ["vue.js", "vue"],
  ["next.js", "nextjs"],
];

const groupByTerm = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) groupByTerm.set(term, group);
}

// The term itself first, then every alias it can be written as.
export function termsFor(normalized: string): string[] {
  return groupByTerm.get(normalized) ?? [normalized];
}
