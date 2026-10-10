import { supabase } from "@/integrations/supabase/client";

// Shared shape for application_follow_up_messages rows — used by the
// candidate "Follow up with employer" dialog and the employer Inbox so both
// sides agree on the same type without duplicating it.
export type FollowUpMessage = {
  id: string;
  application_id: string;
  sender_role: "candidate" | "employer";
  sender_id: string;
  message: string;
  created_at: string;
  read_at: string | null;
};

export const FOLLOW_UP_MESSAGES_TABLE = "application_follow_up_messages";
export const FOLLOW_UP_MESSAGE_SELECT =
  "id, application_id, sender_role, sender_id, message, created_at, read_at";

/**
 * application_follow_up_messages isn't in the generated
 * src/integrations/supabase/types.ts yet (generated file — not hand-edited;
 * regenerate it after 20261009120000_application_follow_up_messages.sql is
 * applied), so every caller needs the same `as any` on the table name — same
 * pattern already used for RPCs not yet in the generated types (see
 * job-feed.ts). Centralized here as one function (one disable comment) so
 * every call site reads as a normal, fully-typed query builder.
 */
export function followUpMessagesTable() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase.from(FOLLOW_UP_MESSAGES_TABLE as any) as any;
}
