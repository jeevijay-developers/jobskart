import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { adminListCompanyEmployees } from "@/lib/admin.functions";

type Employee = {
  user_id: string;
  role: string;
  member_status: string;
  full_name: string | null;
  email: string | null;
  mobile: string | null;
  account_status: string | null;
};

/** Admin-only list of the users linked to one company (employer_members). */
export function CompanyEmployeesDialog({
  company,
  onClose,
}: {
  company: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const list = useServerFn(adminListCompanyEmployees);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "company-employees", company?.id],
    queryFn: () => list({ data: { companyId: company!.id } }),
    enabled: !!company,
  });
  const rows = (data?.rows ?? []) as Employee[];

  return (
    <Dialog open={!!company} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Employees — {company?.name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="p-4 text-sm text-destructive">Couldn't load employees.</p>
          ) : !rows.length ? (
            <p className="p-4 text-sm text-muted-foreground">No employees linked to this company.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((e) => (
                <li key={e.user_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{e.full_name || "—"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[e.email, e.mobile].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant="outline" className="capitalize">
                      {e.role.replace("_", " ")}
                    </Badge>
                    <Badge
                      variant={
                        e.member_status !== "active" || e.account_status === "suspended"
                          ? "destructive"
                          : "secondary"
                      }
                      className="capitalize"
                    >
                      {e.member_status !== "active" ? e.member_status : (e.account_status ?? "active")}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
