// src/lib/invoice-pdf.ts
//
// Tax invoice generator for JobsKart (OptnHire Solutions Pvt. Ltd.) billing
// transactions — credit pack purchases, custom/enterprise plans, and any
// manual billing entries raised by admin.
//
// Follows the same zero-dependency, print-window pattern already used in
// src/lib/jd-pdf.ts: builds a self-contained HTML string, opens it in a new
// window, and triggers the browser's native "Save as PDF". No extra npm
// packages, works on desktop and mobile browsers.
//
// Usage:
//   downloadInvoicePdf(buildInvoiceData({ ...order, company, pack }));
//
// -----------------------------------------------------------------------

// ---------------------------------------------------------------------
// Seller (fixed) — update here if entity/GSTIN/address ever changes
// ---------------------------------------------------------------------
const SELLER = {
  legalName: "OptnHire Solutions Private Limited",
  brand: "JobsKart",
  address: "147, Pratap Nagar, Dadabari, Kota, Rajasthan 324009",
  state: "Rajasthan",
  stateCode: "08", // Rajasthan GST state code — confirm against actual GSTIN once issued
  gstin: "GSTIN APPLIED FOR", // TODO: replace with real GSTIN once available
  pan: "", // not available yet — line is omitted automatically if empty
  email: "billing@jobskart.in", // placeholder — confirm real support/billing email
  website: "indiadrive-jobs.lovable.app", // placeholder — swap for the production domain
};

const GST_RATE = 0.18; // 9% CGST + 9% SGST (intra-state) or 18% IGST (inter-state)

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
export type InvoiceLineItem = {
  description: string; // e.g. "Growth Credit Pack — 500 candidate unlock credits"
  hsnSac?: string; // service accounting code — confirm exact SAC with your CA
  qty: number;
  rateInr: number; // per-unit rate, in whole rupees (ex-GST)
};

export type InvoiceBuyer = {
  companyName: string;
  gstin?: string | null; // buyer's GSTIN, if captured (companies.gst_number)
  pan?: string | null; // companies.pan_number
  billingAddress?: string | null; // not yet in schema — falls back to city
  city?: string | null; // companies.hq_city
  buyerState?: string | null; // determines CGST+SGST vs IGST — see note below
};

export type InvoicePayment = {
  method: "Razorpay" | "Manual" | "Bank Transfer";
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  paidAt?: string; // ISO date
  status: "Paid" | "Pending" | "Refunded";
};

export type InvoiceData = {
  invoiceNumber: string; // e.g. "JK/2026-27/0001" — generate server-side, see migration
  issueDate: string; // ISO date
  placeOfSupply: string; // buyer's state, e.g. "Rajasthan (08)"
  buyer: InvoiceBuyer;
  items: InvoiceLineItem[];
  payment: InvoicePayment;
  notes?: string; // e.g. "Credits are non-refundable once unlocked. See Terms."
};

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Small-scale number-to-words for Indian currency (0 – 99,99,99,999)
export function amountInWords(amount: number): string {
  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
    "Eighteen", "Nineteen",
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const two = (n: number): string => {
    if (n < 20) return a[n];
    return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
  };
  const three = (n: number): string => {
    if (n >= 100) return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + two(n % 100) : "");
    return two(n);
  };

  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  if (rupees === 0) return "Zero Rupees Only";

  let n = rupees;
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = n;

  const parts: string[] = [];
  if (crore) parts.push(three(crore) + " Crore");
  if (lakh) parts.push(three(lakh) + " Lakh");
  if (thousand) parts.push(three(thousand) + " Thousand");
  if (hundred) parts.push(three(hundred));

  let out = parts.join(" ") + " Rupees";
  if (paise) out += " and " + two(paise) + " Paise";
  return out + " Only";
}

function computeTotals(items: InvoiceLineItem[], intraState: boolean) {
  const subtotal = items.reduce((s, i) => s + i.qty * i.rateInr, 0);
  const gstTotal = Math.round(subtotal * GST_RATE * 100) / 100;
  const cgst = intraState ? Math.round((gstTotal / 2) * 100) / 100 : 0;
  const sgst = intraState ? Math.round((gstTotal / 2) * 100) / 100 : 0;
  const igst = intraState ? 0 : gstTotal;
  const total = Math.round((subtotal + gstTotal) * 100) / 100;
  return { subtotal, cgst, sgst, igst, gstTotal, total };
}

// ---------------------------------------------------------------------
// HTML renderer — pure function, reusable for print-window, stored HTML
// snapshot, or server-side PDF rendering later.
// ---------------------------------------------------------------------
export function renderInvoiceHtml(data: InvoiceData): string {
  const intraState =
    (data.buyer.buyerState || "").trim().toLowerCase() === SELLER.state.toLowerCase();
  const { subtotal, cgst, sgst, igst, total } = computeTotals(data.items, intraState);

  const rows = data.items
    .map((it, idx) => {
      const amount = it.qty * it.rateInr;
      return `
      <tr>
        <td class="c">${idx + 1}</td>
        <td>${esc(it.description)}</td>
        <td class="c">${esc(it.hsnSac || "—")}</td>
        <td class="c">${it.qty}</td>
        <td class="r">${inr(it.rateInr)}</td>
        <td class="r">${inr(amount)}</td>
      </tr>`;
    })
    .join("");

  const paymentLine = [
    data.payment.method,
    data.payment.razorpayPaymentId ? `Ref: ${esc(data.payment.razorpayPaymentId)}` : "",
    data.payment.paidAt ? new Date(data.payment.paidAt).toLocaleDateString("en-IN") : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Invoice ${esc(data.invoiceNumber)} · ${SELLER.brand}</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:#fff;color:#1A1A2E;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  .page{max-width:820px;margin:0 auto;padding:44px 48px}

  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1A55BD;padding-bottom:18px;margin-bottom:22px}
  .brand{font-weight:800;letter-spacing:-.02em;color:#1A55BD;font-size:22px}
  .brand .sub{font-weight:600;color:#64748b;font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-top:2px}
  .doctitle{text-align:right}
  .doctitle .t{font-size:13px;font-weight:800;letter-spacing:.08em;color:#0f172a;text-transform:uppercase}
  .doctitle .n{font-size:14px;font-weight:700;color:#1A55BD;margin-top:4px}
  .doctitle .d{font-size:12px;color:#64748b;margin-top:2px}

  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:26px}
  .box h4{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin:0 0 6px;font-weight:700}
  .box .name{font-size:14px;font-weight:700;color:#0f172a;margin-bottom:2px}
  .box .line{font-size:12.5px;color:#475569;line-height:1.6}

  table{width:100%;border-collapse:collapse;margin-bottom:4px}
  thead th{background:#EEF3FF;color:#1A55BD;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;font-weight:700;text-align:left;padding:9px 10px;border-bottom:1px solid #DCE4FA}
  tbody td{font-size:12.5px;color:#1e293b;padding:9px 10px;border-bottom:1px solid #EEF1F6}
  td.c,th.c{text-align:center}
  td.r,th.r{text-align:right}

  .totals{width:280px;margin-left:auto;margin-top:10px}
  .totals .row{display:flex;justify-content:space-between;font-size:12.5px;color:#475569;padding:5px 0}
  .totals .row.grand{border-top:2px solid #1A55BD;margin-top:6px;padding-top:10px;font-size:15px;font-weight:800;color:#0f172a}
  .totals .row.grand .v{color:#1A55BD}

  .words{margin-top:10px;font-size:11.5px;color:#64748b}
  .words b{color:#1e293b}

  .payment{margin-top:26px;background:#F5F7FA;border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;font-size:12.5px}
  .payment .status{font-weight:700;color:#16A34A;background:#F0FDF4;border:1px solid #BBF7D0;padding:3px 10px;border-radius:999px;font-size:11px}

  .notes{margin-top:20px;font-size:11px;color:#94a3b8;line-height:1.6}

  .footer{margin-top:36px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:flex-end}
  .footer .sig{text-align:right;font-size:12px;color:#475569}
  .footer .sig .line{border-top:1px solid #cbd5e1;margin-top:34px;padding-top:6px;width:170px}
  .footer .meta{font-size:10.5px;color:#94a3b8}

  @media print { .no-print{display:none} .page{padding:22px 26px} @page { size:A4; margin:12mm } }
</style>
</head>
<body>
<div class="page">

  <div class="top">
    <div>
      <div class="brand">${SELLER.brand}</div>
      <div class="sub">by ${esc(SELLER.legalName)}</div>
    </div>
    <div class="doctitle">
      <div class="t">Tax Invoice</div>
      <div class="n">${esc(data.invoiceNumber)}</div>
      <div class="d">Date: ${new Date(data.issueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
    </div>
  </div>

  <div class="grid2">
    <div class="box">
      <h4>Billed By</h4>
      <div class="name">${esc(SELLER.legalName)}</div>
      <div class="line">
        ${esc(SELLER.address)}<br/>
        GSTIN: ${esc(SELLER.gstin)}${SELLER.pan ? ` &nbsp;·&nbsp; PAN: ${esc(SELLER.pan)}` : ""}<br/>
        ${esc(SELLER.email)}
      </div>
    </div>
    <div class="box">
      <h4>Billed To</h4>
      <div class="name">${esc(data.buyer.companyName)}</div>
      <div class="line">
        ${esc(data.buyer.billingAddress || data.buyer.city || "Address on file")}<br/>
        ${data.buyer.gstin ? `GSTIN: ${esc(data.buyer.gstin)}<br/>` : "GSTIN: Not provided<br/>"}
        Place of Supply: ${esc(data.placeOfSupply)}
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="c" style="width:32px">#</th>
        <th>Description</th>
        <th class="c" style="width:80px">SAC</th>
        <th class="c" style="width:50px">Qty</th>
        <th class="r" style="width:100px">Rate</th>
        <th class="r" style="width:110px">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${inr(subtotal)}</span></div>
    ${
      intraState
        ? `<div class="row"><span>CGST @ 9%</span><span>${inr(cgst)}</span></div>
           <div class="row"><span>SGST @ 9%</span><span>${inr(sgst)}</span></div>`
        : `<div class="row"><span>IGST @ 18%</span><span>${inr(igst)}</span></div>`
    }
    <div class="row grand"><span>Total</span><span class="v">${inr(total)}</span></div>
  </div>
  <div class="words" style="text-align:right"><b>${esc(amountInWords(total))}</b></div>

  <div class="payment">
    <div>
      <div style="font-weight:700;color:#0f172a">${paymentLine || data.payment.method}</div>
      <div style="color:#94a3b8;font-size:11px;margin-top:2px">Payment reference</div>
    </div>
    <div class="status">${esc(data.payment.status)}</div>
  </div>

  ${data.notes ? `<div class="notes">${esc(data.notes)}</div>` : ""}

  <div class="footer">
    <div class="meta">
      This is a system-generated invoice and does not require a physical signature.<br/>
      ${esc(SELLER.website)} · ${esc(SELLER.email)}
    </div>
    <div class="sig">
      <div class="line">Authorized Signatory</div>
      <div style="margin-top:2px;font-weight:700;color:#0f172a">${esc(SELLER.legalName)}</div>
    </div>
  </div>

</div>
<div class="no-print" style="position:fixed;top:12px;right:12px;display:flex;gap:8px">
  <button onclick="window.print()" style="background:#1A55BD;color:#fff;border:0;border-radius:8px;padding:10px 14px;font-weight:600;cursor:pointer">Download PDF</button>
  <button onclick="window.close()" style="background:#fff;color:#0f172a;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-weight:600;cursor:pointer">Close</button>
</div>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350))</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------
// Print-window trigger — mirrors downloadJdPdf() in src/lib/jd-pdf.ts
// ---------------------------------------------------------------------
export function downloadInvoicePdf(data: InvoiceData) {
  const doc = renderInvoiceHtml(data);
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=1000");
  if (!w) {
    const blob = new Blob([doc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-${data.invoiceNumber.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  w.document.open();
  w.document.write(doc);
  w.document.close();
}

// ---------------------------------------------------------------------
// Convenience builder for the credit-pack purchase flow
// (razorpay_orders row + credit_packs row + companies row -> InvoiceData)
// ---------------------------------------------------------------------
export function buildCreditPackInvoiceData(args: {
  invoiceNumber: string;
  issueDate: string;
  packName: string;
  credits: number;
  amountInr: number; // razorpay_orders.amount_inr (GST-inclusive price shown to buyer today)
  company: { name: string; gstin?: string | null; pan?: string | null; city?: string | null; billingAddress?: string | null; state?: string | null };
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  paidAt?: string;
}): InvoiceData {
  // amount_inr today is GST-inclusive (see plan_settings / credit_packs pricing) —
  // back-calculate the ex-GST rate so the invoice breakup is accurate.
  const exGstRate = Math.round((args.amountInr / (1 + GST_RATE)) * 100) / 100;

  return {
    invoiceNumber: args.invoiceNumber,
    issueDate: args.issueDate,
    placeOfSupply: `${args.company.state || SELLER.state} (India)`,
    buyer: {
      companyName: args.company.name,
      gstin: args.company.gstin,
      pan: args.company.pan,
      city: args.company.city,
      billingAddress: args.company.billingAddress,
      buyerState: args.company.state,
    },
    items: [
      {
        description: `${args.packName} Credit Pack — ${args.credits} candidate unlock credits`,
        hsnSac: "998313", // TODO: confirm exact SAC code with your CA before go-live
        qty: 1,
        rateInr: exGstRate,
      },
    ],
    payment: {
      method: "Razorpay",
      razorpayOrderId: args.razorpayOrderId,
      razorpayPaymentId: args.razorpayPaymentId,
      paidAt: args.paidAt,
      status: "Paid",
    },
    notes:
      "Credits are non-refundable once a candidate is unlocked. For billing queries, contact " +
      SELLER.email + ".",
  };
}

// ---------------------------------------------------------------------
// Build InvoiceData from a stored public.invoices row. Historical
// invoices print exactly as they were issued, even if pricing, pack
// names, or company details change later.
// ---------------------------------------------------------------------
export type StoredInvoiceRow = {
  invoice_number: string;
  issue_date: string;
  line_items: unknown;
  buyer_snapshot: unknown;
  payment_method: string;
  payment_reference: string | null;
  payment_status: string;
};

export function buildStoredInvoiceData(row: StoredInvoiceRow): InvoiceData {
  const buyer = (row.buyer_snapshot ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(row.line_items) ? (row.line_items as Record<string, unknown>[]) : [];

  const items: InvoiceLineItem[] = rawItems.map((i) => ({
    description: String(i.description ?? "Service"),
    hsnSac: i.hsn_sac ? String(i.hsn_sac) : undefined,
    qty: Number(i.qty ?? 1),
    rateInr: Number(i.rate_inr ?? 0),
  }));

  const state = buyer.state ? String(buyer.state) : null;

  return {
    invoiceNumber: row.invoice_number,
    issueDate: row.issue_date,
    placeOfSupply: `${state || buyer.city || "India"}`,
    buyer: {
      companyName: String(buyer.name ?? "—"),
      gstin: buyer.gstin ? String(buyer.gstin) : null,
      pan: buyer.pan ? String(buyer.pan) : null,
      city: buyer.city ? String(buyer.city) : null,
      billingAddress: buyer.address ? String(buyer.address) : null,
      buyerState: state,
    },
    items,
    payment: {
      method: (row.payment_method as InvoicePayment["method"]) ?? "Razorpay",
      razorpayPaymentId: row.payment_reference ?? undefined,
      paidAt: row.issue_date,
      status: (row.payment_status as InvoicePayment["status"]) ?? "Paid",
    },
    notes:
      "Credits are non-refundable once a candidate is unlocked. For billing queries, contact " +
      SELLER.email + ".",
  };
}
