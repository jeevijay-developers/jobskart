# Built-in GST Invoicing for JobsKart

Every paid billing transaction gets a numbered tax invoice (JK/2026-27/0001), stored in the database and downloadable as a PDF from the employer Credits page.

## What gets built

1. **Invoice storage + numbering (database)**
   - Run the attached migration as-is: `invoice_counters` table, `current_financial_year()`, `next_invoice_number()` (atomic per-financial-year counter), the `invoices` table with GST breakup and buyer/line-item snapshots, and `issue_credit_pack_invoice()`.
   - Invoices are read-only to company members (existing membership check) and fully managed by the system role.
   - `issue_credit_pack_invoice` is idempotent per order, so the client verification and the Razorpay webhook can both fire without creating duplicates.

2. **Invoice generator file**
   - Add `src/lib/invoice-pdf.ts` exactly as attached (zero-dependency print-window PDF, same pattern as the existing JD PDF export).

3. **Issue an invoice on every successful payment**
   - `verifyRazorpayPayment()` in `src/lib/credits.functions.ts`: after `apply_credit_delta` succeeds, call `issue_credit_pack_invoice({ _order_id, _razorpay_payment_id })`. Invoice failures are logged, never block credit delivery.
   - Razorpay webhook (`src/routes/api/public/webhooks/razorpay.ts`): same call after credits are applied, so invoices exist even if the buyer closes the tab.

4. **Invoices section on the Credits page**
   - New section under Recent transactions on `/employer/credits`: invoice number, date, description, total, payment status, and a **Download PDF** button per row.
   - Data is read through a new authenticated server function scoped to the caller's company.
   - Download rebuilds the PDF from the stored snapshot (`invoice_number`, `line_items`, `buyer_snapshot`, GST amounts, payment reference) so historical invoices never change when pricing or company details are edited later.
   - Empty state when no invoices exist yet.

## Technical notes

- `issue_credit_pack_invoice` currently treats all sales as inter-state (IGST 18%) because `companies` has no state column; it snapshots `name`, `gst_number`, `pan_number`, `hq_city`. Seller GSTIN in `invoice-pdf.ts` is still the placeholder "GSTIN APPLIED FOR".
- Download uses the stored invoice row directly (not `buildCreditPackInvoiceData`'s re-derivation) where the stored line items already carry ex-GST rates, keeping the printed totals identical to the recorded ones.
- No new npm dependencies.

## Open items for you

- Real GSTIN, PAN, billing email, and production domain in `invoice-pdf.ts` SELLER block.
- Confirm SAC code `998313` with your CA.
- If you want intra-state CGST/SGST split, a company state field is needed — say so and I'll add it.
