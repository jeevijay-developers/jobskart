import type { PermissionDef } from "@/lib/team-permissions";
import type { CompanySettings, RoleRow, SeatStatus, TeamInvite, TeamMember } from "@/lib/team-data";

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

// profiles.email can be an account placeholder unrelated to what the admin typed (mobile-OTP
// accounts get an auto-generated `m<mobile>@jobskart.app` — see TeamMember.invited_email), so the
// email actually invited is preferred over it whenever there's no real name to show.
export const nameOf = (m: {
  profiles: { full_name: string | null; email: string | null } | null;
  invited_email?: string | null;
}) => m.profiles?.full_name || m.invited_email || m.profiles?.email || "Unnamed";

/** True when the signed-in account's email doesn't match what the invite was sent to — worth
 * flagging in the UI since accept_invite() allows this silently (any signed-in account can accept
 * a token). */
export const hasIdentityMismatch = (m: {
  profiles: { email: string | null } | null;
  invited_email?: string | null;
}) =>
  !!m.invited_email &&
  !!m.profiles?.email &&
  m.invited_email.toLowerCase() !== m.profiles.email.toLowerCase();
