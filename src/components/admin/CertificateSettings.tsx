import { useEffect, useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  CERT_ASSET_MAX_BYTES,
  CERT_ASSET_MIME,
  CERT_PLACEHOLDERS,
  CERT_PREFIX_RE,
  DEFAULT_CERT_PREFIX,
  DEFAULT_LAYOUT,
  COVER_RE,
  coverRect,
  mergeLayout,
  type LayoutOverrides,
  formatCertDate,
  addMonths,
  renderCertText,
  type CertValues,
} from "@/lib/certificate-layout";

export type CertAssetKind = "template" | "logo" | "signature" | "signature2";

export type CertSettingsState = {
  enabled: boolean;
  /** Storage paths (private "certificates" bucket) — what gets saved. */
  paths: Record<CertAssetKind, string>;
  /** Signed URLs for the current paths — preview only, never saved. */
  urls: Partial<Record<CertAssetKind, string>>;
  names: Partial<Record<CertAssetKind, string>>;
  issuerName: string;
  prefix: string;
  /** Per-field position / visibility / cover overrides (saved in certificate_config.layout). */
  layout: LayoutOverrides;
};

export const EMPTY_CERT_SETTINGS: CertSettingsState = {
  enabled: false,
  paths: { template: "", logo: "", signature: "", signature2: "" },
  urls: {},
  names: {},
  issuerName: "",
  prefix: DEFAULT_CERT_PREFIX,
  layout: {},
};

const LABELS: Record<CertAssetKind, { title: string; hint: string; required?: boolean }> = {
  template: { title: "Certificate template", hint: "PNG/JPG, landscape certificate design", required: true },
  logo: { title: "Organization logo", hint: "PNG/JPG (optional)" },
  signature: { title: "Signature", hint: "PNG/JPG, transparent PNG preferred (optional)" },
  signature2: { title: "Additional signature", hint: "PNG/JPG, transparent PNG preferred (optional)" },
};

/**
 * Uploads straight from the browser to the private "certificates" bucket using the admin's own
 * session (storage policy "Admins manage certificate files"). Sending the image through a server
 * function as base64 inflated it by a third and hit serverless request-body limits (~4.5 MB),
 * which the browser surfaces as a bare "Failed to fetch".
 */
async function uploadAsset(kind: CertAssetKind, file: File): Promise<{ path: string; previewUrl: string | null }> {
  // Trust the file's own header, not the client-declared mime type.
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isPng = head[0] === 0x89 && head[1] === 0x50;
  const isJpg = head[0] === 0xff && head[1] === 0xd8;
  if (!isPng && !isJpg) throw new Error("That file isn't a valid PNG or JPG image.");

  const folder = kind === "template" ? "templates" : "assets";
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  const up = await supabase.storage
    .from("certificates")
    .upload(path, file, { contentType: isPng ? "image/png" : "image/jpeg", upsert: false });
  if (up.error) throw new Error(up.error.message);
  const { data: signed } = await supabase.storage.from("certificates").createSignedUrl(path, 3600);
  return { path, previewUrl: signed?.signedUrl ?? null };
}

const revoke = (u?: string) => {
  if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
};

function AssetField({
  kind,
  settings,
  onChange,
}: {
  kind: CertAssetKind;
  settings: CertSettingsState;
  onChange: (next: CertSettingsState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const meta = LABELS[kind];
  const path = settings.paths[kind];
  const url = settings.urls[kind];

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!CERT_ASSET_MIME.includes(file.type)) return void toast.error("Only PNG or JPG images are allowed.");
    if (file.size > CERT_ASSET_MAX_BYTES) return void toast.error("Image must be 5 MB or smaller.");
    // Preview the selected file right away from the local copy — never wait for the upload/save.
    const local = URL.createObjectURL(file);
    onChange({
      ...settings,
      urls: { ...settings.urls, [kind]: local },
      names: { ...settings.names, [kind]: file.name },
    });
    setBusy(true);
    try {
      const res = await uploadAsset(kind, file);
      // Keep showing the local copy (identical image); only the stored path changes.
      onChange({
        ...settings,
        paths: { ...settings.paths, [kind]: res.path },
        urls: { ...settings.urls, [kind]: local },
        names: { ...settings.names, [kind]: file.name },
      });
      revoke(settings.urls[kind]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed.";
      toast.error(`Upload failed: ${msg}`);
      // Upload didn't happen: put back whatever was there before.
      onChange(settings);
      URL.revokeObjectURL(local);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = () => {
    revoke(url);
    onChange({
      ...settings,
      paths: { ...settings.paths, [kind]: "" },
      urls: { ...settings.urls, [kind]: undefined },
      names: { ...settings.names, [kind]: undefined },
    });
  };

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
      <Label>
        {meta.title}
        {meta.required && <span className="text-destructive"> *</span>}
      </Label>
      <p className="text-xs text-muted-foreground">{meta.hint}</p>
      {path || url ? (
        <div className="flex items-center gap-3">
          {url ? (
            <img src={url} alt="" className="h-14 w-20 rounded border border-border bg-white object-contain" />
          ) : (
            <div className="h-14 w-20 rounded border border-border bg-white" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
            {settings.names[kind] ?? path.split("/").pop()}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Replace"}
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${meta.title}`} onClick={remove}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
          Upload
        </Button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  );
}

/**
 * Finds the text printed in the template around a clicked point and returns its exact bounding box
 * (in % of the page) plus the surrounding background colour — or null if nothing is there / the
 * browser can't read the image (cross-origin without CORS).
 */
function detectPrintedText(
  img: HTMLImageElement,
  xPct: number,
  yPct: number,
): { box: { x: number; y: number; w: number; h: number }; color: string } | null {
  try {
    const cw = Math.min(1200, img.naturalWidth);
    const ch = Math.round((cw * img.naturalHeight) / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, cw, ch);

    // Search window around the click: wide enough for a long line, short enough to stay on one line.
    const wx0 = Math.max(0, Math.round(((xPct - 45) / 100) * cw));
    const wx1 = Math.min(cw - 1, Math.round(((xPct + 45) / 100) * cw));
    const hy = Math.max(10, Math.round(0.07 * ch));
    const cyPx = Math.min(ch - 1, Math.max(0, Math.round((yPct / 100) * ch)));
    const wy0 = Math.max(0, cyPx - hy);
    const wy1 = Math.min(ch - 1, cyPx + hy);
    const data = ctx.getImageData(wx0, wy0, wx1 - wx0 + 1, wy1 - wy0 + 1);
    const W = data.width;
    const H = data.height;
    const at = (x: number, y: number) => {
      const i = (y * W + x) * 4;
      return [data.data[i], data.data[i + 1], data.data[i + 2]];
    };

    // Background = median colour of the window's edge pixels.
    const edge: number[][] = [];
    for (let x = 0; x < W; x += 3) { edge.push(at(x, 0), at(x, H - 1)); }
    for (let y = 0; y < H; y += 3) { edge.push(at(0, y), at(W - 1, y)); }
    const med = (i: number) => edge.map((p) => p[i]).sort((p, q) => p - q)[Math.floor(edge.length / 2)];
    const bg = [med(0), med(1), med(2)];
    const differs = (x: number, y: number) => {
      const p = at(x, y);
      return Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 90;
    };
    const rowHas = (y: number) => {
      for (let x = 0; x < W; x++) if (differs(x, y)) return true;
      return false;
    };

    // Vertical extent of the text line nearest the click (tolerating small gaps inside glyphs).
    const clickY = cyPx - wy0;
    let seed = -1;
    for (let d = 0; d < H && seed < 0; d++) {
      if (clickY - d >= 0 && rowHas(clickY - d)) seed = clickY - d;
      else if (clickY + d < H && rowHas(clickY + d)) seed = clickY + d;
    }
    if (seed < 0) return null;
    const gap = Math.max(2, Math.round(0.006 * ch));
    let y0 = seed;
    let y1 = seed;
    for (let miss = 0, y = seed - 1; y >= 0 && miss <= gap; y--) { if (rowHas(y)) { y0 = y; miss = 0; } else miss++; }
    for (let miss = 0, y = seed + 1; y < H && miss <= gap; y++) { if (rowHas(y)) { y1 = y; miss = 0; } else miss++; }

    // Horizontal extent: the cluster of columns (within the line's rows) that contains/nearest the click.
    const colHas = (x: number) => {
      for (let y = y0; y <= y1; y++) if (differs(x, y)) return true;
      return false;
    };
    const clickX = Math.round((xPct / 100) * cw) - wx0;
    const colGap = Math.max(4, Math.round(0.04 * cw));
    let seedX = -1;
    for (let d = 0; d < W && seedX < 0; d++) {
      if (clickX - d >= 0 && colHas(clickX - d)) seedX = clickX - d;
      else if (clickX + d < W && colHas(clickX + d)) seedX = clickX + d;
    }
    if (seedX < 0) return null;
    let x0 = seedX;
    let x1 = seedX;
    for (let miss = 0, x = seedX - 1; x >= 0 && miss <= colGap; x--) { if (colHas(x)) { x0 = x; miss = 0; } else miss++; }
    for (let miss = 0, x = seedX + 1; x < W && miss <= colGap; x++) { if (colHas(x)) { x1 = x; miss = 0; } else miss++; }

    const padX = 0.006 * cw;
    const padY = 0.004 * ch;
    const left = Math.max(0, wx0 + x0 - padX);
    const right = Math.min(cw, wx0 + x1 + 1 + padX);
    const top = Math.max(0, wy0 + y0 - padY);
    const bottom = Math.min(ch, wy0 + y1 + 1 + padY);
    return {
      box: { x: (left / cw) * 100, y: (top / ch) * 100, w: ((right - left) / cw) * 100, h: ((bottom - top) / ch) * 100 },
      color: "#" + bg.map((v) => v.toString(16).padStart(2, "0")).join(""),
    };
  } catch {
    return null; // cross-origin image without CORS: canvas is tainted
  }
}

const FIELD_LABELS: Record<string, string> = {
  candidate_name: "Candidate name",
  completed: "Text: has successfully completed",
  course_name: "Course name",
  score: "Score line",
  certificate_id: "Certificate ID",
  issue_date: "Issue date",
  valid_until: "Valid until",
  provider: "Provider / issuer",
};

/** Admin preview: the template as background with the same positioned fields the PDF generator uses. */
function CertificatePreview({
  settings,
  courseTitle,
  validityMonths,
  providerLabel,
  placing,
  onPlace,
}: {
  settings: CertSettingsState;
  courseTitle: string;
  validityMonths: number | null;
  providerLabel: string;
  /** Field id waiting for a click on the template (null = not placing). */
  placing: string | null;
  onPlace: (xPct: number, yPct: number, img: HTMLImageElement) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const tplImg = useRef<HTMLImageElement>(null);
  const [ratio, setRatio] = useState(842 / 595);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, [settings.urls.template]);

  const now = new Date();
  const prefix = CERT_PREFIX_RE.test(settings.prefix.trim()) ? settings.prefix.trim() : DEFAULT_CERT_PREFIX;
  // Sample data only — real certificates are filled in per candidate at generation time.
  const values: CertValues = {
    candidate_name: "Rahul Sharma",
    course_name: courseTitle || "AI Fundamentals Certification",
    certificate_id: `${prefix}-TEST001`,
    issue_date: "07 October 2026",
    score: "100",
    valid_until: validityMonths ? formatCertDate(addMonths(now, validityMonths)) : "Never Expires",
    provider: settings.issuerName.trim() || providerLabel,
  };

  if (!settings.urls.template) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Upload a template to see the certificate preview.
      </p>
    );
  }
  return (
    <div
      ref={box}
      className={`relative mx-auto overflow-hidden rounded-lg border bg-white ${placing ? "cursor-crosshair border-primary ring-2 ring-primary/30" : "border-border"}`}
      style={{ aspectRatio: String(ratio), width: `min(100%, ${420 * ratio}px)` }}
      onClick={(e) => {
        if (!placing || !box.current || !tplImg.current) return;
        const rect = box.current.getBoundingClientRect();
        onPlace(
          ((e.clientX - rect.left) / rect.width) * 100,
          ((e.clientY - rect.top) / rect.height) * 100,
          tplImg.current,
        );
      }}
    >
      <img
        ref={tplImg}
        src={settings.urls.template}
        alt="Certificate template"
        crossOrigin="anonymous"
        className="absolute inset-0 h-full w-full"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight);
        }}
      />
      {mergeLayout(settings.layout)
        .text.filter((b) => b.cover && !(b.skipIfEmpty && !values[b.skipIfEmpty]))
        .map((b) => {
          const c = coverRect(b);
          return (
            <div
              key={`cover-${b.id}`}
              className="absolute"
              style={{
                left: `${c.left}%`,
                top: `${c.top}%`,
                width: `${c.width}%`,
                height: `${c.height}%`,
                backgroundColor: b.cover!,
              }}
            />
          );
        })}
      {DEFAULT_LAYOUT.images.map((b) => {
        const url = settings.urls[b.slot];
        return url ? (
          <img
            key={b.slot}
            src={url}
            alt=""
            className="absolute object-contain"
            style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
          />
        ) : null;
      })}
      {mergeLayout(settings.layout)
        .text.filter((b) => !(b.skipIfEmpty && !values[b.skipIfEmpty]))
        .map((b) => (
          <div
            key={b.id}
            className="absolute leading-tight"
            style={{
              left: `${b.x}%`,
              top: `${b.y}%`,
              width: `${b.w}%`,
              textAlign: b.align,
              fontSize: (height * b.size) / 100,
              fontWeight: b.bold ? 700 : 400,
              color: b.color ?? "#111827",
            }}
          >
            {renderCertText(b.text, values)}
          </div>
        ))}
    </div>
  );
}

export function CertificateSettings({
  value,
  onChange,
  courseTitle,
  providerLabel,
  validityMonths,
}: {
  value: CertSettingsState;
  onChange: (next: CertSettingsState) => void;
  courseTitle: string;
  /** Default issuer shown when Issuer Name is left blank (the certification's Provider). */
  providerLabel: string;
  validityMonths: number | null;
}) {
  const [placing, setPlacing] = useState<string | null>(null);
  const merged = mergeLayout(value.layout);
  const setField = (id: string, patch: LayoutOverrides[string]) =>
    onChange({ ...value, layout: { ...value.layout, [id]: { ...value.layout[id], ...patch } } });

  // Place a field at the clicked point and hide any text the template has printed there.
  const place = (xPct: number, yPct: number, img: HTMLImageElement) => {
    if (!placing) return;
    const base = DEFAULT_LAYOUT.text.find((b) => b.id === placing);
    if (!base) return;
    const found = detectPrintedText(img, xPct, yPct);
    if (found) {
      // Mask exactly the printed text's box and draw the value inside it, vertically centred.
      const { box } = found;
      // Keep the text box at least 40% wide so a longer real value doesn't wrap inside a short placeholder.
      const w = Math.min(100, Math.max(box.w, 40));
      const boxX = base.align === "center" ? box.x + box.w / 2 - w / 2 : base.align === "right" ? box.x + box.w - w : box.x;
      const px = Math.min(100 - w, Math.max(0, boxX));
      const py = Math.min(98, Math.max(0, box.y + box.h / 2 - base.size * 0.6));
      setField(placing, {
        x: px,
        y: py,
        w,
        cover: found.color,
        cx: box.x,
        cy: box.y,
        cw: box.w,
        ch: box.h,
        hidden: false,
      });
    } else {
      // Nothing detected (blank spot / unreadable image): place at the click, no mask.
      toast.error("No printed text found there (or the template colours couldn't be read). Placed without a cover.");
      const w = value.layout[placing]?.w ?? base.w;
      const x = base.align === "center" ? xPct - w / 2 : base.align === "right" ? xPct - w : xPct;
      setField(placing, {
        x: Math.min(100 - w, Math.max(0, x)),
        y: Math.min(98, Math.max(0, yPct - base.size * 0.75)),
        w,
        cover: null,
        cx: undefined,
        cy: undefined,
        cw: undefined,
        ch: undefined,
        hidden: false,
      });
    }
    setPlacing(null);
  };

  return (
    <div className="space-y-4 rounded-xl border border-border p-4 sm:col-span-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">Certificate Settings</h3>
          <p className="text-xs text-muted-foreground">
            A personalised PDF is issued automatically when a candidate passes.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Enable Certificate
          <Switch checked={value.enabled} onCheckedChange={(enabled) => onChange({ ...value, enabled })} />
        </label>
      </div>

      {value.enabled && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <AssetField kind="template" settings={value} onChange={onChange} />
            <AssetField kind="logo" settings={value} onChange={onChange} />
            <AssetField kind="signature" settings={value} onChange={onChange} />
            <AssetField kind="signature2" settings={value} onChange={onChange} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Issuer name</Label>
              <Input
                value={value.issuerName}
                placeholder={providerLabel}
                onChange={(e) => onChange({ ...value, issuerName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Certificate prefix</Label>
              <Input
                value={value.prefix}
                placeholder={DEFAULT_CERT_PREFIX}
                maxLength={16}
                onChange={(e) => onChange({ ...value, prefix: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Letters, numbers and dashes. Validity uses the "Validity (months)" field above.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Certificate preview (sample data)</Label>
            <CertificatePreview
              settings={value}
              courseTitle={courseTitle}
              validityMonths={validityMonths}
              providerLabel={providerLabel}
              placing={placing}
              onPlace={place}
            />
            {value.urls.template && (
              <div className="space-y-2 rounded-xl border border-border bg-surface p-3">
                <p className="text-xs text-muted-foreground">
                  If your template already has text printed where a value goes (e.g. a placeholder name), click{" "}
                  <b>Place</b> and then click that spot on the preview. The value is drawn there and the printed
                  text underneath is covered, so it appears only once. Untick a line to drop it if the template
                  already has it.
                </p>
                {DEFAULT_LAYOUT.text.map((b) => {
                  const shown = merged.text.find((m) => m.id === b.id);
                  const o = value.layout[b.id];
                  const active = placing === b.id;
                  return (
                    <div key={b.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <label className="flex min-w-[10rem] items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={!!shown}
                          onChange={(e) => setField(b.id, { hidden: !e.target.checked })}
                        />
                        {FIELD_LABELS[b.id] ?? b.id}
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant={active ? "default" : "outline"}
                        disabled={!shown}
                        onClick={() => setPlacing(active ? null : b.id)}
                      >
                        {active ? "Click the template…" : "Place"}
                      </Button>
                      <label className="flex items-center gap-1">
                        Width %
                        <input
                          type="number"
                          min={5}
                          max={100}
                          disabled={!shown}
                          value={Math.round(shown?.w ?? b.w)}
                          onChange={(e) => setField(b.id, { w: Number(e.target.value) || b.w })}
                          className="h-7 w-14 rounded border border-border bg-background px-1"
                        />
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          disabled={!shown}
                          checked={!!shown?.cover}
                          onChange={(e) => setField(b.id, { cover: e.target.checked ? (o?.cover ?? "#ffffff") : null })}
                        />
                        Cover template text
                      </label>
                      {shown?.cover && (
                        <input
                          type="color"
                          aria-label={`Cover colour for ${FIELD_LABELS[b.id] ?? b.id}`}
                          value={COVER_RE.test(shown.cover) ? shown.cover : "#ffffff"}
                          onChange={(e) => setField(b.id, { cover: e.target.value })}
                          className="h-7 w-9 cursor-pointer rounded border border-border"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Filled automatically for each candidate:{" "}
              {CERT_PLACEHOLDERS.map((p) => `{{${p}}}`).join("  ")}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
