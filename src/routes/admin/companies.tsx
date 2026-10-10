import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Download, MapPin, XCircle } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/site/Pagination";
import { adminListCompanies, adminSetCompanyVerification } from "@/lib/admin.functions";

const PAGE_SIZE = 10;

export const Route = createFileRoute("/admin/companies")({
  component: Page,
});

type CompanyRow = {
  id: string;
  name: string;
  industry: string | null;
  hq_city: string | null;
  verification_status: string | null;
};

type StatusTab = "all" | "unverified" | "verified" | "rejected";

// Same status values the page already used before this change
// (admin_set_verification writes "verified" | "pending" | "rejected";
// anything else — including null — reads as "unverified").
function normalizeStatus(status: string | null): "verified" | "unverified" | "rejected" {
  if (status === "verified") return "verified";
  if (status === "rejected") return "rejected";
  return "unverified";
}

function statusBadge(status: string | null) {
  const s = normalizeStatus(status);
  if (s === "verified") return <Badge variant="success">Verified</Badge>;
  if (s === "rejected") return <Badge variant="danger">Rejected</Badge>;
  return <Badge variant="warning">Unverified</Badge>;
}

// Client-side CSV export of exactly what's on screen (post search + tab
// filter) — no new RPC/SQL per the task. BOM so Excel (not just browsers)
// opens the UTF-8 file correctly; each field is quoted and internal quotes
// doubled so commas/quotes/newlines in a company name or industry can't
// break column alignment.
function toCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

// Verify/Reject action buttons — same handlers as before (passed in, not
// changed here), but a company that's already verified shows a
// disabled/confirmed "Verified" button instead of an actionable "Verify"
// one, and symmetrically for "rejected". Pending (unverified) keeps both
// active, same as today. Same classes/variants as the KYC Queue's own
// Approve/Reject buttons (bg-success/bg-destructive solid), so this page
// doesn't introduce a second button style.
function ActionButtons({
  status,
  busy,
  onVerify,
  onReject,
  fullWidth,
}: {
  status: string | null;
  busy: boolean;
  onVerify: () => void;
  onReject: () => void;
  fullWidth?: boolean;
}) {
  const s = normalizeStatus(status);
  const sizeClass = fullWidth ? "h-11 flex-1" : "";
  return (
    <>
      {s === "verified" ? (
        <Button
          type="button"
          size={fullWidth ? "default" : "sm"}
          disabled
          aria-disabled="true"
          className={`${sizeClass} gap-1.5 bg-success-light text-success opacity-100 disabled:opacity-100`}
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Verified
        </Button>
      ) : (
        <Button
          type="button"
          size={fullWidth ? "default" : "sm"}
          onClick={onVerify}
          disabled={busy}
          className={`${sizeClass} bg-success text-success-foreground hover:bg-success/90`}
        >
          Verify
        </Button>
      )}
      {s === "rejected" ? (
        <Button
          type="button"
          size={fullWidth ? "default" : "sm"}
          variant="outline"
          disabled
          aria-disabled="true"
          className={`${sizeClass} gap-1.5 border-destructive/20 bg-destructive-light text-destructive opacity-100 disabled:opacity-100`}
        >
          <XCircle className="h-3.5 w-3.5" /> Rejected
        </Button>
      ) : (
        <Button
          type="button"
          size={fullWidth ? "default" : "sm"}
          variant="destructive"
          onClick={onReject}
          disabled={busy}
          className={sizeClass}
        >
          Reject
        </Button>
      )}
    </>
  );
}

function downloadCompaniesCsv(rows: CompanyRow[]) {
  const header = ["Company name", "Industry", "City", "Status"];
  const lines = [header.map(toCsvField).join(",")];
  for (const r of rows) {
    lines.push(
      [r.name, r.industry ?? "", r.hq_city ?? "", normalizeStatus(r.verification_status)]
        .map((v) => toCsvField(String(v)))
        .join(","),
    );
  }
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `companies-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Page() {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<StatusTab>("all");
  const [page, setPage] = useState(1);
  const list = useServerFn(adminListCompanies);
  const setV = useServerFn(adminSetCompanyVerification);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "companies", search],
    queryFn: () => list({ data: { search } }),
  });
  const mut = useMutation({
    mutationFn: (v: { companyId: string; status: "verified" | "pending" | "rejected" }) =>
      setV({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin", "companies"] });
    },
  });
  const rows = useMemo(() => (data?.rows ?? []) as CompanyRow[], [data]);

  // Stat cards and tab counts both come from this same already-loaded page
  // of companies (see the file-level note in the final report: up to 200
  // most-recently-created companies matching the current search box — not
  // every company in the database, since adminListCompanies caps at 200 and
  // this task adds no new RPC/SQL to get a true total).
  const counts = useMemo(() => {
    const c = { all: rows.length, unverified: 0, verified: 0, rejected: 0 };
    for (const r of rows) {
      const s = normalizeStatus(r.verification_status);
      c[s]++;
    }
    return c;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (tab === "all") return rows;
    return rows.filter((r) => normalizeStatus(r.verification_status) === tab);
  }, [rows, tab]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const changeTab = (next: StatusTab) => {
    setTab(next);
    setPage(1);
  };

  return (
    <AdminShell title="Companies" subtitle="Approve and moderate employers">
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Pending review
          </p>
          <p className="mt-1 text-2xl font-bold text-warning">{counts.unverified}</p>
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

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 [scrollbar-width:thin] sm:overflow-visible">
          {(
            [
              { v: "all", label: `All (${counts.all})` },
              { v: "unverified", label: `Unverified (${counts.unverified})` },
              { v: "verified", label: `Verified (${counts.verified})` },
              { v: "rejected", label: `Rejected (${counts.rejected})` },
            ] as const
          ).map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => changeTab(t.v)}
              className={`shrink-0 whitespace-nowrap rounded-md px-4 py-1.5 text-xs font-semibold ${
                tab === t.v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 sm:shrink-0">
          <Input
            placeholder="Search company"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="max-w-xs sm:w-56"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => downloadCompaniesCsv(filteredRows)}
            disabled={filteredRows.length === 0}
            className="shrink-0 gap-1.5 max-sm:hidden"
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => downloadCompaniesCsv(filteredRows)}
          disabled={filteredRows.length === 0}
          className="w-full gap-1.5 sm:hidden"
        >
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : !visibleRows.length ? (
          <p className="p-4 text-sm text-muted-foreground">No companies match these filters.</p>
        ) : (
          <>
            {/* Desktop/tablet: 4-column table. */}
            <div className="hidden min-[900px]:block">
              <div
                role="row"
                className="grid grid-cols-[minmax(14rem,1.6fr)_minmax(9rem,1fr)_minmax(7rem,.7fr)_minmax(13rem,1fr)] gap-4 border-b border-border bg-surface/60 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
              >
                <span role="columnheader">Company details</span>
                <span role="columnheader">Location</span>
                <span role="columnheader">Status</span>
                <span role="columnheader" className="text-right">
                  Action
                </span>
              </div>
              <div className="divide-y divide-border">
                {visibleRows.map((c) => (
                  <div
                    key={c.id}
                    role="row"
                    className="grid grid-cols-[minmax(14rem,1.6fr)_minmax(9rem,1fr)_minmax(7rem,.7fr)_minmax(13rem,1fr)] items-center gap-4 px-4 py-3"
                  >
                    <div role="cell" className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{c.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.industry || "—"}
                      </p>
                    </div>
                    <div role="cell" className="flex min-w-0 items-center gap-1.5 text-sm text-foreground/80">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{c.hq_city || "—"}</span>
                    </div>
                    <div role="cell">{statusBadge(c.verification_status)}</div>
                    <div role="cell" className="flex items-center justify-end gap-2">
                      <ActionButtons
                        status={c.verification_status}
                        busy={mut.isPending}
                        onVerify={() => mut.mutate({ companyId: c.id, status: "verified" })}
                        onReject={() => mut.mutate({ companyId: c.id, status: "rejected" })}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mobile/narrow tablet: one card per company. */}
            <div className="divide-y divide-border min-[900px]:hidden">
              {visibleRows.map((c) => (
                <div key={c.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{c.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.industry || "—"}
                      </p>
                    </div>
                    <div className="shrink-0">{statusBadge(c.verification_status)}</div>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-sm text-foreground/80">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{c.hq_city || "—"}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <ActionButtons
                      status={c.verification_status}
                      busy={mut.isPending}
                      onVerify={() => mut.mutate({ companyId: c.id, status: "verified" })}
                      onReject={() => mut.mutate({ companyId: c.id, status: "rejected" })}
                      fullWidth
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {totalPages > 1 ? (
        <Pagination
          page={currentPage}
          totalPages={totalPages}
          onChange={setPage}
          ariaLabel="Companies pagination"
          className="mt-6 max-sm:flex-nowrap max-sm:gap-0.5 max-sm:overflow-x-auto max-sm:[&_button]:min-w-7 max-sm:[&_button]:px-1.5 max-sm:[&_button]:text-xs max-sm:[&_span]:px-0.5"
        />
      ) : null}
    </AdminShell>
  );
}
