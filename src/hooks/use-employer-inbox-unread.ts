import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FOLLOW_UP_MESSAGES_TABLE, followUpMessagesTable } from "@/lib/applicationFollowUp";

/**
 * Count of unread candidate messages across the employer's company, for the
 * sidebar "Inbox" badge. RLS (the "employer reads company application
 * messages" policy) already scopes this to the caller's own company — no
 * explicit company_id filter is needed since application_follow_up_messages
 * has no company_id column of its own; it reaches company via
 * applications.company_id, which RLS checks per row.
 */
export function useEmployerInboxUnread(companyId: string | null) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!companyId) {
      setCount(0);
      return;
    }
    let cancelled = false;

    const load = async () => {
      const { count: n } = await followUpMessagesTable()
        .select("id", { count: "exact", head: true })
        .eq("sender_role", "candidate")
        .is("read_at", null);
      if (!cancelled) setCount(n ?? 0);
    };
    load();

    const channel = supabase
      .channel(`employer-inbox-unread-${companyId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: FOLLOW_UP_MESSAGES_TABLE },
        (payload) => {
          if ((payload.new as { sender_role?: string }).sender_role === "candidate") {
            setCount((c) => c + 1);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: FOLLOW_UP_MESSAGES_TABLE },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [companyId]);

  return count;
}
