// SERVER-ONLY: renders a certificate PDF from the admin's template and stores it privately.
// Isolated from the exam flow: generateCertificateForPass() never throws to its caller's critical
// path — the exam result is already recorded, a certificate failure only means "no certificate yet".
import { createElement, type ReactElement } from "react";
import { Document, Image, Page, Text, View, renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CERT_ASSET_PATH_RE,
  addMonths,
  coverRect,
  mergeLayout,
  certPrefix,
  formatCertDate,
  imageSize,
  renderCertText,
  type CertImageSlot,
  type CertValues,
  type CertificateConfig,
  type CertificateLayout,
} from "@/lib/certificate-layout";

const BUCKET = "certificates";
const PAGE_WIDTH = 842; // A4 landscape width in points; height follows the template's aspect ratio

export type Asset = { data: Buffer; format: "png" | "jpg" };

async function loadAsset(path: string | null | undefined): Promise<Asset | null> {
  if (!path || !CERT_ASSET_PATH_RE.test(path)) return null;
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const size = imageSize(buf);
  return size ? { data: buf, format: size.format } : null;
}

function randomSuffix(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export async function renderPdf(
  template: Asset,
  images: Partial<Record<CertImageSlot, Asset>>,
  values: CertValues,
  layout: CertificateLayout,
): Promise<Buffer> {
  const dims = imageSize(template.data)!;
  const width = PAGE_WIDTH;
  const height = Math.round((PAGE_WIDTH * dims.height) / dims.width);
  const pct = (n: number) => `${n}%`;

  // Cover patches first (hide any placeholder text printed in the template), then the values.
  const coverNodes = layout.text
    .filter((b) => b.cover && !(b.skipIfEmpty && !values[b.skipIfEmpty]))
    .map((b) => {
      const c = coverRect(b);
      return createElement(View, {
        key: `cover-${b.id}`,
        style: {
          position: "absolute",
          left: pct(c.left),
          top: pct(c.top),
          width: pct(c.width),
          height: pct(c.height),
          backgroundColor: b.cover!,
        },
      });
    });

  const textNodes = layout.text
    .filter((b) => !(b.skipIfEmpty && !values[b.skipIfEmpty]))
    .map((b) =>
      createElement(
        View,
        { key: b.id, style: { position: "absolute", left: pct(b.x), top: pct(b.y), width: pct(b.w) } },
        createElement(
          Text,
          {
            style: {
              textAlign: b.align,
              fontSize: (height * b.size) / 100,
              fontFamily: b.bold ? "Helvetica-Bold" : "Helvetica",
              color: b.color ?? "#111827",
            },
          },
          renderCertText(b.text, values),
        ),
      ),
    );

  const imageNodes = layout.images.flatMap((b) => {
    const asset = images[b.slot];
    if (!asset) return [];
    return [
      createElement(
        View,
        { key: b.slot, style: { position: "absolute", left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) } },
        createElement(Image, { src: asset, style: { width: "100%", height: "100%", objectFit: "contain" } }),
      ),
    ];
  });

  const doc = createElement(
    Document,
    null,
    createElement(
      Page,
      { size: [width, height], style: { position: "relative" } },
      createElement(Image, {
        src: template,
        style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" },
      }),
      ...coverNodes,
      ...imageNodes,
      ...textNodes,
    ),
  ) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(doc);
}

export type GeneratedCertificate = { certificateId: string };

/** Creates the certificate for a passing attempt. Returns null when nothing should/could be issued. */
export async function generateCertificateForPass(args: {
  userId: string;
  certificationId: string;
  score: number;
}): Promise<GeneratedCertificate | null> {
  try {
    const { userId, certificationId, score } = args;

    const { data: cert } = await supabaseAdmin
      .from("certifications")
      .select("id, provider, partner_name, validity_months, certificate_enabled, certificate_config")
      .eq("id", certificationId)
      .maybeSingle();
    const c = cert as unknown as {
      provider: string;
      partner_name: string | null;
      validity_months: number | null;
      certificate_enabled: boolean;
      certificate_config: CertificateConfig | null;
    } | null;
    if (!c?.certificate_enabled) return null;
    const config = c.certificate_config ?? {};

    // One certificate per candidate + certification (also enforced by a unique constraint).
    const existing = await supabaseAdmin
      .from("certificates" as never)
      .select("certificate_id")
      .eq("candidate_id", userId)
      .eq("certification_id", certificationId)
      .maybeSingle();
    const have = existing.data as unknown as { certificate_id: string } | null;
    if (have) return { certificateId: have.certificate_id };

    const template = await loadAsset(config.templatePath);
    if (!template) {
      console.error("[certificate] no usable template for certification", certificationId);
      return null;
    }
    const [logo, signature, signature2] = await Promise.all([
      loadAsset(config.logoPath),
      loadAsset(config.signaturePath),
      loadAsset(config.signature2Path),
    ]);

    const [{ data: profile }, { data: item }, { data: attempt }] = await Promise.all([
      supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      supabaseAdmin.from("content_items").select("title").eq("id", certificationId).maybeSingle(),
      supabaseAdmin
        .from("cert_attempts")
        .select("id")
        .eq("user_id", userId)
        .eq("certification_id", certificationId)
        .eq("passed", true)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const candidateName = profile?.full_name?.trim() || "Candidate";
    const courseName = item?.title ?? "Certification";

    const issuedAt = new Date();
    const validUntil = c.validity_months ? addMonths(issuedAt, c.validity_months) : null;
    const certificateId = `${certPrefix(config)}-${randomSuffix()}`;
    const values: CertValues = {
      candidate_name: candidateName,
      course_name: courseName,
      certificate_id: certificateId,
      issue_date: formatCertDate(issuedAt),
      score: String(score),
      valid_until: validUntil ? formatCertDate(validUntil) : "",
      provider: config.issuerName?.trim() || c.partner_name || "JobsKart",
    };

    const pdf = await renderPdf(
      template,
      { logo: logo ?? undefined, signature: signature ?? undefined, signature2: signature2 ?? undefined },
      values,
      mergeLayout(config.layout),
    );

    const path = `generated/${userId}/${certificateId}.pdf`;
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, pdf, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (up.error) throw up.error;

    const ins = await supabaseAdmin.from("certificates" as never).insert({
      certificate_id: certificateId,
      certification_id: certificationId,
      candidate_id: userId,
      attempt_id: attempt?.id ?? null,
      candidate_name: candidateName,
      course_name: courseName,
      score,
      issued_at: issuedAt.toISOString(),
      valid_until: validUntil ? validUntil.toISOString() : null,
      certificate_file_url: path,
      status: "active",
    } as never);
    if (ins.error) {
      // Lost a race with a parallel submission: keep theirs, drop our orphan file.
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      const again = await supabaseAdmin
        .from("certificates" as never)
        .select("certificate_id")
        .eq("candidate_id", userId)
        .eq("certification_id", certificationId)
        .maybeSingle();
      const row = again.data as unknown as { certificate_id: string } | null;
      if (row) return { certificateId: row.certificate_id };
      throw ins.error;
    }
    return { certificateId };
  } catch (e) {
    console.error("[certificate] generation failed", e);
    return null;
  }
}
