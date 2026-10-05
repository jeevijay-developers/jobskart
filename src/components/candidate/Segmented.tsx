import { useState } from "react";

interface SegmentedOptions<T> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  // Opt-in: splits the bar evenly across its container instead of sizing each
  // tab to its own label (default), so existing callers keep their current look.
  fullWidth?: boolean;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  fullWidth = false,
}: SegmentedOptions<T>) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-border ${fullWidth ? "flex w-full" : "inline-flex"}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          value={option.value}
          onClick={() => onChange(option.value)}
          className={`px-3 py-1 text-xs font-medium ${fullWidth ? "flex-1 text-center" : ""} ${
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-surface"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
