import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Minus, Plus, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { ResumeLayoutSettings } from "@/lib/resumeBuilder/schema";
import {
  ACCENT_SWATCHES,
  FONT_LABELS,
  MARGIN_PRESETS,
  type FontKey,
} from "@/lib/resumeBuilder/templates/theme";

// LaTeX-style typesetting controls (geometry / enumitem / vspace equivalents).
// Edits stay local until "Save changes" is clicked; only then do they reach the
// preview and the next generated version (same model as "Edit Your Resume").

const HEX = /^#[0-9a-fA-F]{6}$/;

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex w-full min-w-0 overflow-hidden rounded-lg border border-border">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 min-w-0 whitespace-nowrap px-1.5 py-1 text-center text-xs font-medium ${
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-surface"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SectionHeadingStyleControl({
  value,
  onChange,
}: {
  value: ResumeLayoutSettings["sectionHeaderStyle"];
  onChange: (value: ResumeLayoutSettings["sectionHeaderStyle"] | undefined) => void;
}) {
  const options: { value: ResumeLayoutSettings["sectionHeaderStyle"]; label: string }[] = [
    { value: "underline", label: "Underline" },
    { value: "plain", label: "Plain" },
    { value: "colored", label: "Colored" },
  ];

  return (
    <div
      className="flex w-full min-w-0 overflow-hidden rounded-lg border border-border lg:w-auto"
      role="radiogroup"
      aria-label="Section headings"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(value === option.value ? undefined : option.value)}
          className={`min-w-0 flex-1 whitespace-nowrap px-1.5 py-1 text-center text-xs font-medium lg:flex-none lg:px-2.5 ${
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

function Stepper({
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (n: number) => string;
  onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.round(Math.min(max, Math.max(min, n)) * 100) / 100;
  const btn =
    "grid h-7 w-7 place-items-center rounded-md border border-border bg-background text-muted-foreground hover:bg-surface disabled:opacity-40";
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        className={btn}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
        aria-label="Decrease"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="w-12 text-center text-xs font-semibold tabular-nums text-foreground">
        {format ? format(value) : value}
      </span>
      <button
        type="button"
        className={btn}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
        aria-label="Increase"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// Margin box that can be cleared while typing (a plain controlled number input
// snaps back to 0 the moment it's emptied, making it impossible to retype).
function MarginInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
      <span className="relative mt-0.5 block lg:hidden">
        <input
          type="number"
          min={0}
          max={120}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value !== "" && Number.isFinite(Number(e.target.value)))
              onCommit(Number(e.target.value));
          }}
          onBlur={() => {
            if (text === "") setText(String(value));
          }}
          className="form-input h-8 w-full min-w-0 py-0 pl-1.5 pr-7 text-xs tabular-nums [appearance:auto]"
          style={{ boxSizing: "border-box" }}
        />
        <span className="absolute inset-y-px right-px flex w-5 flex-col overflow-hidden rounded-r-md border-l border-border bg-background lg:hidden">
          <button
            type="button"
            onClick={() => onCommit(Math.min(120, value + 1))}
            className="grid flex-1 place-items-center text-muted-foreground hover:bg-surface hover:text-foreground"
            aria-label={`Increase ${label} margin`}
          >
            <ChevronUp className="h-2.5 w-2.5" />
          </button>
          <button
            type="button"
            onClick={() => onCommit(Math.max(0, value - 1))}
            className="grid flex-1 place-items-center border-t border-border text-muted-foreground hover:bg-surface hover:text-foreground"
            aria-label={`Decrease ${label} margin`}
          >
            <ChevronDown className="h-2.5 w-2.5" />
          </button>
        </span>
      </span>
      <input
        type="number"
        min={0}
        max={120}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value !== "" && Number.isFinite(Number(e.target.value)))
            onCommit(Number(e.target.value));
        }}
        onBlur={() => {
          if (text === "") setText(String(value));
        }}
        className="form-input mt-0.5 hidden h-8 w-full min-w-0 py-0 pl-1.5 pr-4 text-xs tabular-nums [appearance:auto] lg:block"
        style={{ boxSizing: "border-box" }}
      />
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
    </div>
  );
}

export function ResumeLayoutEditor({
  value,
  onChange,
  onReset,
  dirty = false,
  saving = false,
  onSave,
  hideActions = false,
  className = "",
}: {
  value: ResumeLayoutSettings;
  onChange: (next: ResumeLayoutSettings) => void;
  onReset?: () => void;
  dirty?: boolean;
  saving?: boolean;
  onSave?: () => void;
  // When the caller already renders its own Save/Reset bar (e.g. the edit drawer), skip this one.
  hideActions?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(value.accentColor);
  // Keep the text box in step when the colour changes from outside (reset, template switch).
  useEffect(() => setHexDraft(value.accentColor), [value.accentColor]);
  const set = (patch: Partial<ResumeLayoutSettings>) => onChange({ ...value, ...patch });

  const currentMargins =
    value.marginPreset === "custom" && value.margins
      ? value.margins
      : MARGIN_PRESETS[value.marginPreset === "custom" ? "standard" : value.marginPreset];
  const setMargin = (side: keyof typeof currentMargins, n: number) => {
    const v = Math.min(120, Math.max(0, Number.isFinite(n) ? n : 0));
    set({ marginPreset: "custom", margins: { ...currentMargins, [side]: v } });
  };

  const pickAccent = (hex: string) => {
    setHexDraft(hex);
    set({ accentColor: hex });
  };

  return (
    <section className={`rounded-2xl border border-border bg-card p-5 shadow-sm ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <SlidersHorizontal className="h-4 w-4" /> Layout &amp; Design
          {dirty && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-warning">
              Unsaved
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <div>
            <Row label="Margins">
              <Segmented
                value={value.marginPreset}
                onChange={(v) =>
                  set(
                    v === "custom"
                      ? { marginPreset: "custom", margins: currentMargins }
                      : { marginPreset: v, margins: undefined },
                  )
                }
                options={[
                  { value: "compact", label: "Compact" },
                  { value: "standard", label: "Standard" },
                  { value: "spacious", label: "Spacious" },
                  { value: "custom", label: "Custom" },
                ]}
              />
            </Row>
            {value.marginPreset === "custom" && (
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {(["top", "bottom", "left", "right"] as const).map((side) => (
                  <MarginInput
                    key={side}
                    label={side}
                    value={currentMargins[side]}
                    onCommit={(n) => setMargin(side, n)}
                  />
                ))}
              </div>
            )}
            <p className="mt-1 text-[10px] text-muted-foreground">
              Page margins in points (72pt = 1 inch).
            </p>
          </div>

          <Row label="Font">
            <select
              value={value.fontFamily}
              onChange={(e) => set({ fontFamily: e.target.value as FontKey })}
              className="form-input h-8 w-auto py-0 text-xs"
            >
              {(Object.keys(FONT_LABELS) as FontKey[]).map((k) => (
                <option key={k} value={k}>
                  {FONT_LABELS[k]}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Font size">
            <Stepper
              value={value.baseFontSize}
              min={8}
              max={14}
              step={0.5}
              format={(n) => `${n}pt`}
              onChange={(n) => set({ baseFontSize: n })}
            />
          </Row>

          <Row label="Line spacing">
            <Stepper
              value={value.lineHeightScale}
              min={0.8}
              max={1.6}
              step={0.05}
              format={(n) => `×${n.toFixed(2)}`}
              onChange={(n) => set({ lineHeightScale: n })}
            />
          </Row>

          <Row label="Section spacing">
            <Stepper
              value={value.sectionSpacingScale}
              min={0.6}
              max={1.8}
              step={0.1}
              format={(n) => `×${n.toFixed(1)}`}
              onChange={(n) => set({ sectionSpacingScale: n })}
            />
          </Row>

          <Row label="Section headings">
            <SectionHeadingStyleControl
              value={value.sectionHeaderStyle}
              onChange={(sectionHeaderStyle) => set({ sectionHeaderStyle })}
            />
          </Row>

          <div>
            <Row label="Accent color">
              <div className="flex items-center gap-1.5">
                {ACCENT_SWATCHES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.label}
                    onClick={() => pickAccent(c.value)}
                    className={`h-5 w-5 rounded-full border-2 ${
                      value.accentColor.toLowerCase() === c.value.toLowerCase()
                        ? "border-foreground"
                        : "border-transparent ring-1 ring-border"
                    }`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
            </Row>
            <div className="mt-2 flex items-center justify-end gap-2">
              <span className="text-[10px] text-muted-foreground">Custom</span>
              <input
                value={hexDraft}
                onChange={(e) => {
                  setHexDraft(e.target.value);
                  if (HEX.test(e.target.value)) set({ accentColor: e.target.value });
                }}
                maxLength={7}
                placeholder="#1A55BD"
                className={`form-input h-8 w-24 py-0 text-xs ${HEX.test(hexDraft) ? "" : "border-destructive"}`}
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Used for the header band, heading text or underline, and links.
            </p>
          </div>

          {!hideActions && (
            <>
              <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={onReset}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={!dirty || saving}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
              {dirty && (
                <p className="text-[11px] text-warning">
                  You have unsaved layout changes — click Save changes to update the preview.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
