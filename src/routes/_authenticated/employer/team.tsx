import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, ShieldCheck, Users } from "lucide-react";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { RoleGate } from "@/components/employer/RoleGate";
import { MembersTab } from "@/components/employer/team/MembersTab";
import { RolesTab } from "@/components/employer/team/RolesTab";
import { CreditsTab } from "@/components/employer/team/CreditsTab";
import type { TeamContext } from "@/components/employer/team/types";
import { useEmployerRole } from "@/hooks/use-employer-role";
import { mapTeamError, type PermissionDef } from "@/lib/team-permissions";
import {
  fetchCompanySettings,
  fetchCustomRolesEnabled,
  fetchPermissionCatalog,
  fetchRoles,
  fetchSeatStatus,
  fetchTeam,
  type CompanySettings,
  type RoleRow,
  type SeatStatus,
  type TeamInvite,
  type TeamMember,
} from "@/lib/team-data";

type TeamTab = "members" | "roles" | "credits";
const TABS: Array<{ id: TeamTab; label: string; icon: typeof Users }> = [
  { id: "members", label: "Members", icon: Users },
  { id: "roles", label: "Roles & permissions", icon: ShieldCheck },
  { id: "credits", label: "Credits", icon: Coins },
];

export const Route = createFileRoute("/_authenticated/employer/team")({
  head: () => ({ meta: [{ title: "Team · JobsKart" }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: TeamTab } => ({
    tab:
      search.tab === "roles" || search.tab === "credits" || search.tab === "members"
        ? search.tab
        : undefined,
  }),
  component: TeamPage,
});

function TeamPage() {
  const { tab = "members" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const {
    loading: roleLoading,
    userId,
    companyId,
    accessMessage: roleAccessMessage,
    can,
    permissions,
    isSuperAdmin,
    refresh,
  } = useEmployerRole();

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [revoked, setRevoked] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [customRolesEnabled, setCustomRolesEnabled] = useState(false);
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [seats, setSeats] = useState<SeatStatus | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const [team, roleRows, defs, customOk, companySettings, seatStatus] = await Promise.all([
        fetchTeam(companyId),
        fetchRoles(companyId),
        fetchPermissionCatalog(),
        fetchCustomRolesEnabled(companyId),
        fetchCompanySettings(companyId),
        fetchSeatStatus(companyId),
      ]);
      setMembers(team.members);
      setRevoked(team.revoked);
      setInvites(team.invites);
      setRoles(roleRows);
      setCatalog(defs);
      setCustomRolesEnabled(customOk);
      setSettings(companySettings);
      setSeats(seatStatus);
      setDataError(null);
    } catch (e) {
      setDataError(mapTeamError((e as Error)?.message) || "Couldn't load team details.");
    } finally {
      setDataLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A change to roles/permissions can alter what the current user may do: refresh both.
  const reload = useCallback(async () => {
    await Promise.all([refresh(), load()]);
  }, [refresh, load]);

  const ctx: TeamContext | null = useMemo(
    () =>
      companyId
        ? {
            companyId,
            userId,
            can,
            permissions: permissions ?? [],
            isOwner: isSuperAdmin,
            customRolesEnabled,
            catalog,
            roles,
            members,
            revoked,
            invites,
            settings,
            seats,
            reload,
          }
        : null,
    [
      companyId,
      userId,
      can,
      permissions,
      isSuperAdmin,
      customRolesEnabled,
      catalog,
      roles,
      members,
      revoked,
      invites,
      settings,
      seats,
      reload,
    ],
  );

  const accessMessage = roleAccessMessage ?? dataError;
  const allowed = can("team.view") || can("credits.view_own");

  return (
    <EmployerShell
      title="Team"
      subtitle="Roles, permissions and credits for everyone who works in your company."
    >
      <div className="space-y-6">
        {accessMessage && (
          <p className="rounded-lg bg-destructive-light px-3 py-2 text-xs text-destructive">
            {accessMessage}
          </p>
        )}

        {!roleLoading && !allowed ? (
          <RoleGate allowed={false} />
        ) : (
          <>
            <div
              role="tablist"
              aria-label="Team sections"
              className="flex gap-1 overflow-x-auto border-b border-border"
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => navigate({ search: { tab: t.id } })}
                  className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
                    tab === t.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <t.icon className="h-4 w-4" /> {t.label}
                </button>
              ))}
            </div>

            {roleLoading || dataLoading || !ctx ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : tab === "members" ? (
              <MembersTab ctx={ctx} />
            ) : tab === "roles" ? (
              <RolesTab ctx={ctx} />
            ) : (
              <CreditsTab ctx={ctx} />
            )}
          </>
        )}
      </div>
    </EmployerShell>
  );
}
