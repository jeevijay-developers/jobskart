import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  MapPin,
  Briefcase,
  Lock,
  Loader2,
  Phone,
  Mail,
  UserRound,
  Coins,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyCompanies, getActiveCompanyId, type EmployerMembership } from "@/lib/employer";
import {
  getCompanyWallet,
  listUnlockedCandidateIds,
  unlockCandidateContact,
} from "@/lib/credits.functions";
import { INDIAN_CITIES } from "@/lib/options";

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
  profiles: {
    full_name: string | null;
    avatar_url: string | null;
    city: string | null;
    mobile: string | null;
    email: string | null;
  } | null;
};

function maskName(name: string | null) {
  if (!name) return "Candidate";
  const parts = name.trim().split(" ");
  return parts.map((p) => (p ? p[0] + "•••" : "")).join(" ");
}
function maskMobile(m: string | null) {
  if (!m) return "+91 •••• •• ••••";
  const digits = m.replace(/\D/g, "").slice(-10);
  return `+91 ${digits.slice(0, 2)}•••• ${digits.slice(-3)}`;
}

function DatabasePage() {
  const [active, setActive] = useState<EmployerMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [balance, setBalance] = useState(0);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [contacts, setContacts] = useState<Record<string, { full_name: string; mobile: string; email: string }>>({});

  // filters
  const [q, setQ] = useState("");
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [cityInput, setCityInput] = useState("");
  const [minExp, setMinExp] = useState<number | "">("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const ms = await fetchMyCompanies(u.user.id);
      const storedId = getActiveCompanyId();
      const chosen = ms.find((m) => m.company_id === storedId) ?? ms[0] ?? null;
      setActive(chosen);
      if (chosen) {
        const [w, ids] = await Promise.all([
          getCompanyWallet({ data: { companyId: chosen.company_id } }),
          listUnlockedCandidateIds({ data: { companyId: chosen.company_id } }),
        ]);
        setBalance(w.balance);
        setUnlocked(new Set(ids));
      }
      await runSearch();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = async () => {
    setSearching(true);
    try {
      let query = supabase
        .from("candidate_profiles")
        .select(
          "user_id, profile_slug, headline, last_role, years_experience, skills, preferred_cities, preferred_work_mode, profiles!candidate_profiles_user_id_fkey (full_name, avatar_url, city, mobile, email)",
        )
        .eq("onboarding_completed", true)
        .order("profile_strength", { ascending: false })
        .limit(40);

      if (selectedCities.length > 0) {
        query = query.overlaps("preferred_cities", selectedCities);
      }
      if (typeof minExp === "number") query = query.gte("years_experience", minExp);
      if (q.trim()) {
        const term = q.trim();
        query = query.or(`headline.ilike.%${term}%,last_role.ilike.%${term}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      setResults((data || []) as unknown as Candidate[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  };

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

  const cities = useMemo(() => ["", ...INDIAN_CITIES], []);

  if (loading) {
    return (
      <EmployerShell title="Candidate database">
        <div className="h-40 animate-pulse rounded-2xl bg-card" />
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
        <div className="grid gap-3 sm:grid-cols-[1fr_220px_160px_auto]">
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
            <select
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
            </select>
            {void cityInput}{void setCityInput}
          </div>
          <select
            value={minExp}
            onChange={(e) => setMinExp(e.target.value === "" ? "" : Number(e.target.value))}
            className="h-11 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          >
            <option value="">Any experience</option>
            <option value={0}>Fresher (0+)</option>
            <option value={1}>1+ years</option>
            <option value={3}>3+ years</option>
            <option value={5}>5+ years</option>
          </select>
          <button
            type="submit"
            disabled={searching}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </button>
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
          const profile = c.profiles;
          return (
            <article
              key={c.user_id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:flex sm:flex-wrap"
            >
              <div className="flex min-w-0 items-center gap-3 sm:flex-1">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary-light text-primary font-bold">
                  {(profile?.full_name?.[0] ?? "C").toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">
                    {isUnlocked ? profile?.full_name ?? contact?.full_name : maskName(profile?.full_name ?? null)}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {c.headline || c.last_role || "Candidate"}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {profile?.city && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {profile.city}
                      </span>
                    )}
                    {typeof c.years_experience === "number" && (
                      <span className="inline-flex items-center gap-1">
                        <Briefcase className="h-3 w-3" /> {c.years_experience} yrs
                      </span>
                    )}
                  </div>
                  {c.skills && c.skills.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {c.skills.slice(0, 5).map((s) => (
                        <span key={s} className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-foreground">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2 sm:items-end">
                {isUnlocked ? (
                  <div className="space-y-1 text-right text-sm">
                    <p className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                      <Phone className="h-3.5 w-3.5 text-primary" />
                      {contact?.mobile || profile?.mobile}
                    </p>
                    {(contact?.email || profile?.email) && (
                      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" /> {contact?.email || profile?.email}
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="text-right text-xs text-muted-foreground">{maskMobile(profile?.mobile ?? null)}</p>
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
    </EmployerShell>
  );
}
