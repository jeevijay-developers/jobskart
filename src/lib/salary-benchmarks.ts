// Market salary/experience benchmarks by category and city tier, for the
// JobWizard "Location & Pay" step insight banner.

export type RoleBenchmark = {
  minSalary: number;
  maxSalary: number;
  incentiveModel: "fixed" | "fixed_incentive" | "incentive_only";
  avgIncentive: number;
  experienceBucket: "fresher" | "experienced";
  minExp: number;
  maxExp: number;
};

const TIER1_CITIES = new Set(["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Pune", "Navi Mumbai"]);
const TIER2_CITIES = new Set([
  "Ahmedabad", "Kolkata", "Jaipur", "Lucknow", "Indore", "Patna", "Surat",
  "Nagpur", "Bhopal", "Vadodara", "Chandigarh", "Coimbatore", "Kochi",
]);

function cityTier(city?: string): 1 | 2 | 3 {
  if (!city) return 2;
  if (TIER1_CITIES.has(city)) return 1;
  if (TIER2_CITIES.has(city)) return 2;
  return 3;
}

// Base (tier-2) monthly ranges per category — multiplied by tier factor below.
type Base = {
  min: number; max: number;
  model: RoleBenchmark["incentiveModel"]; incentive: number;
  bucket: RoleBenchmark["experienceBucket"]; minExp: number; maxExp: number;
};

const CATEGORY_BASE: Record<string, Base> = {
  Sales: { min: 15000, max: 22000, model: "fixed_incentive", incentive: 8000, bucket: "fresher", minExp: 0, maxExp: 2 },
  Delivery: { min: 14000, max: 19000, model: "fixed_incentive", incentive: 4000, bucket: "fresher", minExp: 0, maxExp: 1 },
  Driver: { min: 16000, max: 22000, model: "fixed", incentive: 0, bucket: "experienced", minExp: 1, maxExp: 5 },
  Telecaller: { min: 13000, max: 18000, model: "fixed_incentive", incentive: 3000, bucket: "fresher", minExp: 0, maxExp: 2 },
  "Customer Support": { min: 15000, max: 21000, model: "fixed", incentive: 0, bucket: "fresher", minExp: 0, maxExp: 2 },
  "Data Entry": { min: 13000, max: 17000, model: "fixed", incentive: 0, bucket: "fresher", minExp: 0, maxExp: 2 },
  Security: { min: 14000, max: 18000, model: "fixed", incentive: 0, bucket: "fresher", minExp: 0, maxExp: 3 },
  Housekeeping: { min: 12000, max: 16000, model: "fixed", incentive: 0, bucket: "fresher", minExp: 0, maxExp: 3 },
  Cook: { min: 15000, max: 22000, model: "fixed", incentive: 0, bucket: "experienced", minExp: 1, maxExp: 5 },
  "Field Agent": { min: 15000, max: 20000, model: "fixed_incentive", incentive: 5000, bucket: "fresher", minExp: 0, maxExp: 2 },
  Retail: { min: 14000, max: 19000, model: "fixed", incentive: 0, bucket: "fresher", minExp: 0, maxExp: 2 },
  Warehouse: { min: 14000, max: 19000, model: "fixed", incentive: 0, bucket: "fresher", minExp: 0, maxExp: 2 },
  Nursing: { min: 18000, max: 28000, model: "fixed", incentive: 0, bucket: "experienced", minExp: 1, maxExp: 6 },
  Teaching: { min: 16000, max: 26000, model: "fixed", incentive: 0, bucket: "experienced", minExp: 1, maxExp: 6 },
  IT: { min: 25000, max: 45000, model: "fixed", incentive: 0, bucket: "experienced", minExp: 1, maxExp: 6 },
};

const DEFAULT_BASE: Base = { min: 14000, max: 20000, model: "fixed", incentive: 0, bucket: "fresher", minExp: 0, maxExp: 2 };

const TIER_FACTOR: Record<1 | 2 | 3, number> = { 1: 1.25, 2: 1, 3: 0.85 };

// title is reserved for a future per-role override beyond category-level
// benchmarks (e.g. seasoned roles within Sales paying above the category
// baseline) — not used yet, kept in the signature for API stability.
export function getRoleBenchmarks(_title: string, category: string, city?: string): RoleBenchmark {
  const base = CATEGORY_BASE[category] ?? DEFAULT_BASE;
  const factor = TIER_FACTOR[cityTier(city)];
  const round100 = (n: number) => Math.round(n / 100) * 100;
  return {
    minSalary: round100(base.min * factor),
    maxSalary: round100(base.max * factor),
    incentiveModel: base.model,
    avgIncentive: base.incentive ? round100(base.incentive * factor) : 0,
    experienceBucket: base.bucket,
    minExp: base.minExp,
    maxExp: base.maxExp,
  };
}
