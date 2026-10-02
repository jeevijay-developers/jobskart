import { useState } from "react";

interface SegmentedOptions<T> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({ value, options, onChange }: SegmentedOptions<T>) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-border">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          value={option.value}
          onClick={() => onChange(option.value)}
          className={`px-3 py-1 text-xs font-medium ${
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
