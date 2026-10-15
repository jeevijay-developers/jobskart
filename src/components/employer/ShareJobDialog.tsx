import { useCallback, useEffect, useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ThemedListDropdown } from "@/components/ui/themed-form-controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { mapTeamError } from "@/lib/team-permissions";
import { fetchTeam, type TeamMember } from "@/lib/team.client";

type Access = "viewer" | "editor" | "owner";
const ACCESS_OPTIONS: Array<{ value: Access; label: string }> = [
  { value: "viewer", label: "Viewer — sees applicants" },
  { value: "editor", label: "Editor — works applicants" },
  { value: "owner", label: "Co-owner — manages the job" },
];

const nameOf = (m: TeamMember) => m.profiles?.full_name || m.profiles?.email || "Unnamed";

export function ShareJobDialog({
  job,
  companyId,
  onClose,
}: {
  job: { id: string; title: string } | null;
  companyId: string | null;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [shared, setShared] = useState<Array<{ user_id: string; access: Access }>>([]);
  const [pick, setPick] = useState("");
  const [access, setAccess] = useState<Access>("editor");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!job || !companyId) return;
    try {
      const [team, rows] = await Promise.all([
        fetchTeam(companyId),
        supabase.from("job_members").select("user_id, access").eq("job_id", job.id),
      ]);
      setMembers(team.members);
      setShared((rows.data ?? []) as Array<{ user_id: string; access: Access }>);
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    }
  }, [job, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!job) return null;

  const sharedIds = new Set(shared.map((s) => s.user_id));
  const candidates = members.filter((m) => m.user_id !== undefined && !sharedIds.has(m.user_id));
  const options = candidates.map((m) => ({ value: m.user_id, label: nameOf(m) }));

  const add = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("share_job", {
        _job_id: job.id,
        _user_id: pick,
        _access: access,
      });
      if (error) throw error;
      toast.success("Job shared");
      setPick("");
      await load();
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("unshare_job", { _job_id: job.id, _user_id: userId });
      if (error) throw error;
      toast.success("Access removed");
      await load();
    } catch (e) {
      toast.error(mapTeamError((e as Error)?.message));
    } finally {
      setBusy(false);
    }
  };

  const nameById = new Map(members.map((m) => [m.user_id, nameOf(m)]));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share “{job.title}”</DialogTitle>
          <DialogDescription>
            Give a teammate access to this job's applicants even if their role would not normally
            see it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {shared.length === 0 && (
            <p className="text-xs text-muted-foreground">Not shared with anyone yet.</p>
          )}
          {shared.map((s) => (
            <div
              key={s.user_id}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {nameById.get(s.user_id) ?? "Teammate"}
              </span>
              <span className="rounded-full bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
                {s.access}
              </span>
              <button
                onClick={() => remove(s.user_id)}
                disabled={busy}
                className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-card text-destructive hover:bg-destructive-light disabled:opacity-60"
                aria-label="Remove access"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <ThemedListDropdown
            label="Teammate"
            value={pick}
            onChange={setPick}
            options={
              options.length ? options : [{ value: "", label: "Everyone already has access" }]
            }
          />
          <ThemedListDropdown
            label="Access"
            value={access}
            onChange={(v) => setAccess(v as Access)}
            options={ACCESS_OPTIONS}
          />
          <button
            onClick={add}
            disabled={busy || !pick}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-60"
          >
            <UserPlus className="h-4 w-4" /> Share
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
