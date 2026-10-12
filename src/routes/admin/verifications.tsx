import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, CheckCircle2, Download, Eye, FileText, Loader2, MessageSquare, Search, ShieldX, XCircle } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/verifications")({
  head: () => ({ meta: [{ title: "KYC Queue · JobsKart Admin" }] }),
  component: Page,
});

type Row = {
  id: string; company_id: string; method: string; status: string;
  reference: string | null; notes: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  docs: any; created_at: string;
  companies: { name: string; slug: string | null } | null;
};

type Tab = "all" | "pending" | "verified" | "rejected";
type DocTypeFilter = "all" | "gst" | "email" | "manual";
type SortOrder = "newest" | "oldest";

function companyInitials(name: string | null | undefined) {
  return (name || "—").trim().slice(0, 2).toUpperCase();
}

// Approve/Reject — same decide() handler as before (passed in, not changed
// here), but now rendered on every tab (not just Pending), so a submission
// that's already Verified shows a disabled "Verified" state instead of an
// actionable Approve, and symmetrically for Rejected — same status-aware
// pattern as the Companies admin page's ActionButtons. Pending keeps both
// active, same as today. The RPC itself (admin_set_verification) is unchanged.
function ActionButtons({
  status,
  busy,
  onApprove,
  onReject,
}: {
  status: string;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <>
      {status === "verified" ? (
        <Button
          type="button"
          size="sm"
          disabled
          aria-disabled="true"
          className="gap-1.5 bg-success-light text-success opacity-100 disabled:opacity-100 max-sm:h-11 max-sm:flex-1"
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Verified
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          onClick={onApprove}
          disabled={busy}
          className="gap-1.5 bg-success text-success-foreground hover:bg-success/90 max-sm:h-11 max-sm:flex-1"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />} Approve
        </Button>
      )}
      {status === "rejected" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          aria-disabled="true"
          className="gap-1.5 border-destructive/20 bg-destructive-light text-destructive opacity-100 disabled:opacity-100 max-sm:h-11 max-sm:flex-1"
        >
          <XCircle className="h-3.5 w-3.5" /> Rejected
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={onReject}
          disabled={busy}
          className="gap-1.5 max-sm:h-11 max-sm:flex-1"
        >
          <ShieldX className="h-3.5 w-3.5" /> Reject
        </Button>
      )}
    </>
  );
}

function toCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadSubmissionsCsv(rows: Row[], tab: Tab) {
  const header = ["Company name", "Method", "Reference", "Submitted at", "Note", "Status"];
  const lines = [header.map(toCsvField).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.companies?.name ?? "",
        r.method,
        r.reference ?? "",
        new Date(r.created_at).toLocaleString(),
        r.notes ?? "",
        // Each row's own status (not the active tab) — the "All" tab mixes
        // pending/verified/rejected rows in one list, so the export must
        // reflect each row's actual status, same as the other tabs already did.
        r.status,
      ]
        .map((v) => toCsvField(String(v)))
        .join(","),
    );
  }
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `company-verifications-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Page() {
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState<Tab>("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Stat cards / tab count pills need all three statuses' counts at once,
  // but `load()` below only ever fetches ONE status at a time (whichever
  // tab is active) — so this is a second, independent, lightweight query
  // (status column only, same table, no new RPC/SQL) that always reflects
  // all three counts regardless of which tab is open. Capped the same way
  // every other admin list page already caps its "all rows" query.
  const [counts, setCounts] = useState({ all: 0, pending: 0, verified: 0, rejected: 0 });
  const loadCounts = async () => {
    const { data } = await supabase
      .from("company_verifications")
      .select("status")
      .limit(1000);
    const c = { all: 0, pending: 0, verified: 0, rejected: 0 };
    for (const row of (data ?? []) as { status: string }[]) {
      c.all++;
      if (row.status === "pending") c.pending++;
      else if (row.status === "verified") c.verified++;
      else if (row.status === "rejected") c.rejected++;
    }
    setCounts(c);
  };

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("company_verifications")
      .select("*, companies(name, slug)")
      .order("created_at", { ascending: false })
      .limit(200);
    // "All" uses the same existing list query, just without the status
    // filter, so it shows every submission (pending + verified + rejected).
    if (tab !== "all") q = q.eq("status", tab);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows(((data as unknown) as Row[]) || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);
  useEffect(() => { loadCounts(); }, []);

  const decide = async (r: Row, status: "verified" | "rejected") => {
    const notes = status === "rejected" ? window.prompt("Rejection reason (optional):") ?? "" : "";
    setBusy(r.id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase.rpc("admin_set_verification" as any, {
        _id: r.id, _status: status, _notes: notes,
      });
      if (error) throw error;
      toast.success(status === "verified" ? "Company verified" : "Rejected");
      setRows((prev) => prev.filter((x) => x.id !== r.id));
      loadCounts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(null); }
  };

  // Search / Doc Type / Sort are pure client-side view state over the
  // currently loaded tab's rows — they never change what `load()` fetches
  // or touch Approve/Reject in any way.
  const [search, setSearch] = useState("");
  const [docType, setDocType] = useState<DocTypeFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");

  // Method values that actually exist in the data (kyc_method enum:
  // gst | email | manual) — the Doc Type select's options are built from
  // this, not guessed.
  const DOC_TYPES: { value: DocTypeFilter; label: string }[] = [
    { value: "all", label: "All Submissions" },
    { value: "gst", label: "GST" },
    { value: "email", label: "Email" },
    { value: "manual", label: "Manual KYC" },
  ];

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let next = rows.filter((r) => {
      if (docType !== "all" && r.method !== docType) return false;
      if (!q) return true;
      return (
        (r.companies?.name ?? "").toLowerCase().includes(q) ||
        (r.reference ?? "").toLowerCase().includes(q)
      );
    });
    next = [...next].sort((a, b) => {
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sort === "newest" ? -diff : diff;
    });
    return next;
  }, [rows, search, docType, sort]);

  return (
    <AdminShell title="Verifications" subtitle="Review Employer KYC submissions and Business Authenticity Documents.">
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Pending review
          </p>
          <p className="mt-1 text-2xl font-bold text-warning">{counts.pending}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Verified total
          </p>
          <p className="mt-1 text-2xl font-bold text-success">{counts.verified}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Rejected
          </p>
          <p className="mt-1 text-2xl font-bold text-destructive">{counts.rejected}</p>
        </div>
      </div>

      <div className="mb-4 flex gap-1.5 self-start overflow-x-auto rounded-full border border-border bg-card p-1 shadow-[var(--shadow-card)] [scrollbar-width:thin] sm:inline-flex sm:w-auto sm:gap-1.5 sm:p-1">
        {(
          [
            { v: "all", label: `All (${counts.all})` },
            { v: "pending", label: `Pending (${counts.pending})` },
            { v: "verified", label: `Verified (${counts.verified})` },
            { v: "rejected", label: `Rejected (${counts.rejected})` },
          ] as const
        ).map((t) => (
          <button
            key={t.v}
            type="button"
            onClick={() => setTab(t.v)}
            className={`flex h-11 flex-1 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-4 text-xs sm:h-[34px] sm:flex-initial sm:px-[18px] sm:text-[13px] ${
              tab === t.v
                ? "bg-primary font-semibold text-primary-foreground"
                : "font-medium text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-card)] sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by company name or reference"
            aria-label="Search by company name or reference"
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Select value={docType} onValueChange={(v) => setDocType(v as DocTypeFilter)}>
            <SelectTrigger aria-label="Doc Type" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOC_TYPES.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as SortOrder)}>
            <SelectTrigger aria-label="Sort" className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => downloadSubmissionsCsv(visibleRows, tab)}
          disabled={visibleRows.length === 0}
          className="gap-1.5 sm:w-auto"
        >
          <Download aria-hidden="true" className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      ) : visibleRows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? "Nothing here." : "No submissions match these filters."}
        </p>
      ) : (
        <ul className="space-y-3">
          {visibleRows.map((r) => {
            const docs = Array.isArray(r.docs) ? r.docs as { path: string; name: string }[] : [];
            return (
              <li key={r.id} className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div
                      aria-hidden="true"
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-light text-sm font-bold text-primary"
                    >
                      {companyInitials(r.companies?.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="break-words font-semibold text-foreground">{r.companies?.name ?? "Company"}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="uppercase font-medium">{r.method}</span>
                        {r.reference ? ` · ${r.reference}` : ""} · {new Date(r.created_at).toLocaleString()}
                      </p>
                      {r.notes && (
                        <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 text-xs text-foreground/80">
                          <MessageSquare aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="break-words">{r.notes}</span>
                        </p>
                      )}
                      {docs.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {docs.map((d) => (
                            <button key={d.path}
                              onClick={async () => {
                                const { data } = await supabase.storage.from("company-docs").createSignedUrl(d.path, 300);
                                if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-semibold hover:bg-foreground/5">
                              <FileText className="h-3 w-3" /> {d.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 max-sm:w-full">
                    {docs.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label="View uploaded document"
                        title="View uploaded document"
                        onClick={async () => {
                          const { data } = await supabase.storage
                            .from("company-docs")
                            .createSignedUrl(docs[0].path, 300);
                          if (data?.signedUrl) window.open(data.signedUrl, "_blank");
                        }}
                        className="max-sm:h-11 max-sm:w-11 max-sm:shrink-0"
                      >
                        <Eye aria-hidden="true" className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <ActionButtons
                      status={r.status}
                      busy={busy === r.id}
                      onApprove={() => decide(r, "verified")}
                      onReject={() => decide(r, "rejected")}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AdminShell>
  );
}
