import type { PermissionDef } from "@/lib/team-permissions";
import type {
  CompanySettings,
  RoleRow,
  SeatStatus,
  TeamInvite,
  TeamMember,
} from "@/lib/team-data";

/** Everything the three Team tabs share; assembled once by the page. */
export type TeamContext = {
  companyId: string;
  userId: string | null;
  can: (permission: string) => boolean;
  permissions: string[];
  isOwner: boolean;
  customRolesEnabled: boolean;
  catalog: PermissionDef[];
  roles: RoleRow[];
  members: TeamMember[];
  revoked: TeamMember[];
  invites: TeamInvite[];
  settings: CompanySettings | null;
  seats: SeatStatus | null;
  reload: () => Promise<void>;
};

export const nameOf = (m: {
  profiles: { full_name: string | null; email: string | null } | null;
}) => m.profiles?.full_name || m.profiles?.email || "Unnamed";
