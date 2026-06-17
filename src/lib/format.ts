export function formatSalary(min?: number | null, max?: number | null, period = "monthly") {
  if (!min && !max) return "Not disclosed";
  const fmt = (n: number) => {
    if (n >= 100000) return `₹${(n / 100000).toFixed(n % 100000 === 0 ? 0 : 1)} L`;
    if (n >= 1000) return `₹${Math.round(n / 1000)}k`;
    return `₹${n}`;
  };
  const suffix = period === "monthly" ? "/mo" : period === "yearly" ? "/yr" : "";
  if (min && max && min !== max) return `${fmt(min)} – ${fmt(max)}${suffix}`;
  return `${fmt(min || max || 0)}${suffix}`;
}

export function formatExperience(min?: number | null, max?: number | null) {
  if (min == null && max == null) return "Any experience";
  if (!min || min === 0) return max ? `0 – ${max} yrs` : "Fresher";
  if (!max || max === min) return `${min}+ yrs`;
  return `${min} – ${max} yrs`;
}

export function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function jobTypeLabel(t: string) {
  return (
    {
      full_time: "Full-time",
      part_time: "Part-time",
      contract: "Contract",
      internship: "Internship",
      temporary: "Temporary",
    } as Record<string, string>
  )[t] || t;
}

export function workModeLabel(t: string) {
  return ({ onsite: "On-site", remote: "Remote", hybrid: "Hybrid", field: "Field job" } as Record<string, string>)[t] || t;
}
