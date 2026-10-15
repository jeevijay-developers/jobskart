import { ShieldAlert } from "lucide-react";
import type { PermissionDef } from "@/lib/team-permissions";
import { groupPermissions } from "@/lib/team-permissions";

export function PermissionMatrix({
  defs,
  selected,
  onToggle,
  isDisabled,
  readOnly,
}: {
  defs: PermissionDef[];
  selected: ReadonlySet<string>;
  onToggle: (key: string, checked: boolean) => void;
  /** Permissions the editor may not hand out (they don't hold them themselves). */
  isDisabled?: (key: string) => boolean;
  readOnly?: boolean;
}) {
  const groups = groupPermissions(defs);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <fieldset key={g.group} className="rounded-xl border border-border bg-surface p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {g.group}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {g.items.map((p) => {
              const checked = selected.has(p.key);
              const disabled = !!readOnly || !!isDisabled?.(p.key);
              return (
                <label
                  key={p.key}
                  className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                    checked ? "border-primary/40 bg-primary-light/30" : "border-border bg-card"
                  } ${disabled ? "opacity-60" : "cursor-pointer hover:border-primary/40"}`}
                  title={
                    disabled && !readOnly
                      ? "You can only grant permissions you hold yourself"
                      : p.description
                  }
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => onToggle(p.key, e.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      {p.label}
                      {p.is_sensitive && (
                        <ShieldAlert
                          className="h-3 w-3 text-warning"
                          aria-label="Sensitive permission"
                        />
                      )}
                    </span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">
                      {p.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
