import { ThemedSelect } from "@/components/ui/themed-form-controls";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  MapPin,
  Briefcase,
  Lock,
  Loader2,
  Mail,
  UserRound,
  Coins,
  X,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import {
  ApplicantReviewPanel,
  type ReviewApplicant,
} from "@/components/employer/ApplicantReviewPanel";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId, type EmployerMembership } from "@/lib/employer";
import {
  getCompanyWallet,
  listUnlockedCandidateIds,
  unlockCandidateContact,
} from "@/lib/credits.functions";
import { INDIAN_CITIES } from "@/lib/options";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Pagination } from "@/components/site/Pagination";
import { usePaginatedQuery } from "@/hooks/use-paginated-query";

const DATABASE_PAGE_SIZE = 20;

export const Route = createFileRoute("/_authenticated/employer/database")({
  head: () => ({ meta: [{ title: "Candidate database · JobsKart Employer" }] }),
  component: DatabasePage,
});

type Candidate = {
  user_id: string;
  profile_slug: string | null;
  headline: string | null;
  last_role: string | null;
  years_experience: number | null;
  skills: string[] | null;
  preferred_cities: string[] | null;
  preferred_work_mode: string | null;
  full_name: string | null;
  avatar_url: string | null;
  city: string | null;
};

function maskName(name: string | null) {
  if (!name) return "Candidate";
  const parts = name.trim().split(" ");
  return parts.map((p) => (p ? p[0] + "•••" : "")).join(" ");
}
const MASKED_MOBILE = "+91 •••• •• ••••";
function experienceLabel(minExp: number) {
  if (minExp === 0) return "Fresher (0+)";
  return `${minExp}+ years`;
}

function DatabasePage() {
  const [active, setActive] = useState<EmployerMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [gated, setGated] = useState(false);
  const [balance, setBalance] = useState(0);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [contacts, setContacts] = useState<Record<string, { full_name: string; mobile: string; email: string }>>({});

  // Draft filters (live as the employer types/picks) vs. submitted filters
  // (what's actually searched) — city/query only take effect on Search;
  // experience narrows immediately, matching the dropdown's existing UX.
  const [q, setQ] = useState("");
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [cityInput, setCityInput] = useState("");
  const [minExp, setMinExp] = useState<number | "">("");
  const [submitted, setSubmitted] = useState({ query: "", cities: [] as string[], minExp: "" as number | "" });
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [reviewApplicant, setReviewApplicant] = useState<ReviewApplicant | null>(null);
  const [reviewHasApplication, setReviewHasApplication] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const ms = await fetchMyCompanies(u.user.id);
      const storedId = getActiveCompanyId();
      const chosen = ms.find((m) => m.company_id === storedId) ?? ms[0] ?? null;
      setActive(chosen);
      if (chosen) {
        // Gate: require ≥1 active, non-expired job
        const nowIso = new Date().toISOString();
        const { count } = await supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("company_id", chosen.company_id)
          .eq("status", "active" as never)
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
        if (!count) {
          setGated(true);
          setLoading(false);
          return;
        }
        const [w, ids] = await Promise.all([
          getCompanyWallet({ data: { companyId: chosen.company_id } }),
          listUnlockedCandidateIds({ data: { companyId: chosen.company_id } }),
        ]);
        setBalance(w.balance);
        setUnlocked(new Set(ids));
      }
      setLoading(false);
    })();
  }, []);

  const {
    rows: results,
    totalPages,
    page,
    setPage,
    isLoading: searching,
    error: searchError,
  } = usePaginatedQuery<Candidate>({
    queryKey: [
      "employer-database-search",
      active?.company_id,
      submitted.query,
      submitted.cities,
      submitted.minExp,
    ],
    pageSize: DATABASE_PAGE_SIZE,
    enabled: !!active && !gated,
    fetchPage: async ({ from }) => {
      if (!active) return { rows: [], total: 0 };
      const { data, error } = await supabase.rpc("search_candidates_for_company", {
        _company_id: active.company_id,
        _query: submitted.query.trim() || undefined,
        _cities: submitted.cities.length > 0 ? submitted.cities : undefined,
        _min_experience: typeof submitted.minExp === "number" ? submitted.minExp : undefined,
        _limit: DATABASE_PAGE_SIZE,
        _offset: from,
      });
      if (error) throw error;
      const rows = (data || []) as unknown as Array<Candidate & { total_count: number }>;
      return { rows, total: rows[0]?.total_count ?? 0 };
    },
  });

  useEffect(() => {
    if (!searchError) return;
    const message = searchError instanceof Error ? searchError.message : "";
    if (message.includes("no_active_job")) {
      toast.error("Post an active job to search the database.");
    } else if (message.includes("insufficient_permissions")) {
      toast.error("You don't have access to this company's database.");
    } else {
      toast.error(message || "Search failed.");
    }
  }, [searchError]);

  const runSearch = () => setSubmitted({ query: q, cities: selectedCities, minExp });

  const handleUnlock = async (c: Candidate) => {
    if (!active) return;
    if (balance < 1) {
      toast.error("Out of credits. Buy a pack to unlock.");
      return;
    }
    setUnlockingId(c.user_id);
    try {
      const r = await unlockCandidateContact({
        data: { companyId: active.company_id, candidateUserId: c.user_id },
      });
      setContacts((prev) => ({ ...prev, [c.user_id]: r.contact }));
      setUnlocked((prev) => new Set(prev).add(c.user_id));
      setBalance(r.balance);
      toast.success(r.alreadyUnlocked ? "Already unlocked." : `Unlocked · ${r.balance} credits left`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unlock failed.");
    } finally {
      setUnlockingId(null);
    }
  };

  // Unlocked candidates open the same review panel used on Responses/applicants.
  // Most database-search candidates haven't applied to a job at this company, so
  // there's no application row to seed it with — open immediately with what's
  // already known (search result + unlocked contact), then upgrade in place if a
  // real application to one of this company's jobs turns up.
  const openProfile = (c: Candidate) => {
    const contact = contacts[c.user_id];
    setReviewHasApplication(false);
    setReviewApplicant({
      id: c.user_id,
      candidate_id: c.user_id,
      status: "",
      created_at: new Date().toISOString(),
      cover_note: null,
      expected_salary: null,
      available_from: null,
      profiles: {
        full_name: c.full_name ?? contact?.full_name ?? null,
        email: contact?.email ?? null,
        mobile: contact?.mobile ?? null,
        city: c.city,
      },
      candidate_profiles: {
        profile_slug: c.profile_slug,
        headline: c.headline,
        last_role: c.last_role,
        skills: c.skills,
      },
    });

    if (!active) return;
    supabase
      .from("applications")
      .select("id, status, created_at, cover_note, expected_salary, available_from, jobs!inner (company_id)")
      .eq("candidate_id", c.user_id)
      .eq("jobs.company_id", active.company_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setReviewHasApplication(true);
        setReviewApplicant((prev) =>
          prev && prev.candidate_id === c.user_id
            ? {
                ...prev,
                id: data.id,
                status: data.status,
                created_at: data.created_at,
                cover_note: data.cover_note,
                expected_salary: data.expected_salary,
                available_from: data.available_from,
              }
            : prev,
        );
      });
  };

  const handleReviewStatusChange = async (status: string) => {
    if (!reviewApplicant || !reviewHasApplication) {
      toast.info("This candidate hasn't applied to a job at your company yet.");
      return;
    }
    const { error } = await supabase
      .from("applications")
      .update({ status } as never)
      .eq("id", reviewApplicant.id);
    if (error) return toast.error(error.message);
    toast.success(`Marked as ${status}`);
    setReviewApplicant((prev) => (prev ? { ...prev, status } : prev));
  };

  const cities = useMemo(() => ["", ...INDIAN_CITIES], []);

  if (loading) {
    return (
      <EmployerShell title="Candidate database">
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
      </EmployerShell>
    );
  }

  if (gated) {
    return (
      <EmployerShell title="Candidate database" subtitle="Unlock the database by posting your first job.">
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-10 text-center">
          <UserRound className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-bold">Post a job to search the database</h3>
          <p className="mt-1 text-sm text-muted-foreground">Access to our candidate database is available to employers with at least one live job post.</p>
          <a href="/employer/jobs/new" className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark">
            <Briefcase className="h-4 w-4" /> Post your first job
          </a>
        </div>
      </EmployerShell>
    );
  }

  return (
    <EmployerShell
      title="Candidate database"
      subtitle="Search verified candidates. Unlock contact details with credits."
      actions={
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground shadow-sm">
          <Coins className="h-4 w-4 text-primary" />
          <span className="tabular-nums">{balance}</span>
          <span className="text-xs font-medium text-muted-foreground">credits</span>
        </div>
      }
    >
      {/* filters */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
        className="rounded-2xl border border-border bg-card p-4 shadow-sm"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_220px_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search role, headline or skill (e.g. driver)"
              className="h-11 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </label>
          <div className="relative">
            <ThemedSelect
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v && !selectedCities.includes(v)) setSelectedCities([...selectedCities, v]);
              }}
              className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              <option value="">+ Add city ({selectedCities.length})</option>
              {cities.filter((c) => c && !selectedCities.includes(c)).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </ThemedSelect>
            {void cityInput}{void setCityInput}
          </div>
          <button
            type="submit"
            disabled={searching}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </button>
        </div>

        <div className="mt-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-surface"
              >
                {typeof minExp === "number" ? experienceLabel(minExp) : "Any experience"}
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={minExp === "" ? "any" : String(minExp)}
                onValueChange={(v) => {
                  const next = v === "any" ? "" : Number(v);
                  setMinExp(next);
                  setSubmitted((s) => ({ ...s, minExp: next }));
                }}
              >
                <DropdownMenuRadioItem value="any">Any experience</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="0">Fresher (0+)</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="1">1+ years</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="3">3+ years</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="5">5+ years</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {selectedCities.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedCities.map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-primary-light px-3 py-1 text-xs font-semibold text-primary">
                <MapPin className="h-3 w-3" /> {c}
                <button
                  type="button"
                  onClick={() => setSelectedCities(selectedCities.filter((x) => x !== c))}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-primary/10"
                  aria-label={`Remove ${c}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setSelectedCities([])}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          </div>
        )}
      </form>

      {/* results */}
      <div className="mt-6 space-y-3">
        {results.length === 0 && !searching && (
          <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-10 text-center">
            <UserRound className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-semibold text-foreground">No matching candidates</p>
            <p className="mt-1 text-xs text-muted-foreground">Try widening your filters.</p>
          </div>
        )}

        {results.map((c) => {
          const isUnlocked = unlocked.has(c.user_id);
          const contact = contacts[c.user_id];
          return (
            <article
              key={c.user_id}
              onClick={isUnlocked ? () => openProfile(c) : undefined}
              role={isUnlocked ? "button" : undefined}
              tabIndex={isUnlocked ? 0 : undefined}
              onKeyDown={
                isUnlocked
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openProfile(c);
                      }
                    }
                  : undefined
              }
              className={`relative rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex sm:flex-wrap sm:items-center sm:gap-4 ${
                isUnlocked ? "cursor-pointer hover:border-primary/40" : ""
              }`}
            >
              {/*
                Mobile (below sm:): the masked-mobile/Unlock block is
                absolutely positioned to the card's top-right, since the
                original side-by-side grid vertically centered it next to
                the *whole* left column — including the skills chips, which
                could grow taller than the button and end up overlapped by
                it. Only the name/headline/location row reserves right-side
                `pr-*` space for the button — skills sit in their own
                full-width row below, clear of the button vertically, so
                they get the full card width to wrap horizontally instead of
                being squeezed into a narrow leftover column. Desktop
                (sm: and up) is untouched — same sm:flex sm:flex-wrap as
                before, `sm:static`/`sm:pr-0` cancel the mobile-only changes.
              */}
              <div className="flex min-w-0 items-center gap-3 sm:flex-1">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary-light text-primary font-bold">
                  {(c.full_name?.[0] ?? "C").toUpperCase()}
                </div>
                <div className="min-w-0 flex-1 pr-32 sm:pr-0">
                  <p className="truncate font-semibold text-foreground">
                    {isUnlocked ? c.full_name ?? contact?.full_name : maskName(c.full_name)}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {c.headline || c.last_role || "Candidate"}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {c.city && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {c.city}
                      </span>
                    )}
                    {typeof c.years_experience === "number" && (
                      <span className="inline-flex items-center gap-1">
                        <Briefcase className="h-3 w-3" /> {c.years_experience} yrs
                      </span>
                    )}
                  </div>
                  {c.skills && c.skills.length > 0 && (
                    <div className="mt-2 hidden flex-wrap gap-1.5 sm:flex">
                      {c.skills.slice(0, 4).map((s) => (
                        <span key={s} className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-foreground">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Mobile-only: skills get their own full-width row below the
                  info block (not squeezed into the pr-32-constrained
                  column), so chips actually wrap side-by-side instead of
                  stacking one per line. Desktop keeps the original chips
                  block above, inside the info column. */}
              {c.skills && c.skills.length > 0 && (
                <div className="mt-2 flex w-full flex-wrap gap-1.5 sm:hidden">
                  {c.skills.slice(0, 4).map((s) => (
                    <span key={s} className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-foreground">
                      {s}
                    </span>
                  ))}
                </div>
              )}

              <div className="absolute right-4 top-4 flex shrink-0 flex-col items-end gap-2 sm:static sm:items-end">
                {isUnlocked ? (
                  <div className="space-y-1 text-right text-sm">
                    <p className="font-semibold text-foreground">{contact?.mobile}</p>
                    {contact?.email && (
                      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" /> {contact.email}
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="text-right text-xs text-muted-foreground">{MASKED_MOBILE}</p>
                    <button
                      onClick={() => handleUnlock(c)}
                      disabled={unlockingId === c.user_id}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground/90 px-3 text-xs font-semibold text-background hover:bg-foreground disabled:opacity-50"
                    >
                      {unlockingId === c.user_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Lock className="h-3.5 w-3.5" />
                      )}
                      Unlock · 1 credit
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onChange={setPage} className="mt-6" />}

      {reviewApplicant && (
        <ApplicantReviewPanel
          applicant={reviewApplicant}
          onClose={() => setReviewApplicant(null)}
          onStatusChange={handleReviewStatusChange}
        />
      )}
    </EmployerShell>
  );
}
