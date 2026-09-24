import { motion } from "framer-motion";
import { jobQualityLabel, type JobQualityGap } from "@/lib/jobQuality";

export function JobQualityMeter({
  score,
  gaps,
  celebrate,
  onGapClick,
}: {
  score: number;
  gaps: JobQualityGap[];
  celebrate?: boolean;
  onGapClick: (step: 0 | 1 | 2 | 3) => void;
}) {
  const { label, color } = jobQualityLabel(score);
  const top = gaps[0] ?? null;
  const line = top ? top.label : "Looks solid — check the JD and publish.";
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary-light/40 px-3 py-2">
      <motion.div
        animate={celebrate ? { scale: [1, 1.25, 1], rotate: [0, 8, -8, 0] } : { scale: 1 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-card text-xs font-bold text-primary"
        aria-label={`Job quality ${score} out of 100 — ${label}`}
      >
        {score}
      </motion.div>
      <button
        type="button"
        className="min-w-0 flex-1 text-left text-sm text-foreground"
        onClick={() => top && onGapClick(top.step)}
      >
        <span className={`mr-1.5 text-xs font-semibold ${color}`}>{label}</span>
        {celebrate ? "Excellent post! Top 10% quality." : line}
      </button>
    </div>
  );
}
