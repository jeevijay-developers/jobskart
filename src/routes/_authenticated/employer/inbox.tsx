import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Inbox as InboxIcon, Loader2, Search, Send } from "lucide-react";
import { EmployerShell } from "@/components/employer/EmployerShell";
import { useEmployerRole } from "@/hooks/use-employer-role";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FOLLOW_UP_MESSAGES_TABLE,
  FOLLOW_UP_MESSAGE_SELECT,
  followUpMessagesTable,
  type FollowUpMessage,
} from "@/lib/applicationFollowUp";

export const Route = createFileRoute("/_authenticated/employer/inbox")({
  component: InboxPage,
});

const MAX_LEN = 500;

const statusVariant: Record<string, NonNullable<BadgeProps["variant"]>> = {
  applied: "info",
  shortlisted: "warning",
  interview: "warning",
  hired: "success",
  rejected: "danger",
  withdrawn: "muted",
};

type ChatRow = {
  applicationId: string;
  jobId: string;
  jobTitle: string;
  candidateId: string;
  candidateName: string;
  status: string;
  lastMessage: string;
  lastAt: string;
  unread: number;
};

function formatMsgTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${time}`;
}

function InboxPage() {
  const { companyId, loading: roleLoading } = useEmployerRole();
  const isMobile = useIsMobile();

  const [rows, setRows] = useState<ChatRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [search, setSearch] = useState("");
  const [jobFilter, setJobFilter] = useState<string>("all");
  const [selected, setSelected] = useState<ChatRow | null>(null);

  // Two-step fetch: applications for this company's jobs, then this
  // company's follow-up messages — aggregated client-side into one row per
  // application (last message + unread count). The candidate-DB "search
  // candidates" RPC pattern isn't reused here since this just needs the
  // company's own applications, not cross-company ranked search.
  const loadList = async () => {
    if (!companyId) return;
    setLoadingList(true);
    setListError(null);
    const { data: apps, error: appsErr } = await supabase
      .from("applications")
      .select("id, job_id, candidate_id, status, jobs (title), profiles:candidate_id (full_name)")
      .eq("company_id", companyId);
    if (appsErr) {
      setListError(appsErr.message);
      setLoadingList(false);
      return;
    }
    const appIds = (apps ?? []).map((a) => a.id);
    if (appIds.length === 0) {
      setRows([]);
      setLoadingList(false);
      return;
    }
    const { data: msgs, error: msgErr } = await followUpMessagesTable()
      .select(FOLLOW_UP_MESSAGE_SELECT)
      .in("application_id", appIds)
      .order("created_at", { ascending: true });
    if (msgErr) {
      setListError(msgErr.message);
      setLoadingList(false);
      return;
    }
    const byApp = new Map<string, FollowUpMessage[]>();
    for (const m of (msgs ?? []) as FollowUpMessage[]) {
      const list = byApp.get(m.application_id) ?? [];
      list.push(m);
      byApp.set(m.application_id, list);
    }
    const built: ChatRow[] = [];
    for (const a of apps ?? []) {
      const list = byApp.get(a.id);
      if (!list || list.length === 0) continue; // only applications with ≥1 message
      const last = list[list.length - 1];
      const unread = list.filter((m) => m.sender_role === "candidate" && !m.read_at).length;
      built.push({
        applicationId: a.id,
        jobId: a.job_id,
        jobTitle: (a.jobs as { title?: string } | null)?.title || "Job removed",
        candidateId: a.candidate_id,
        candidateName: (a.profiles as { full_name?: string } | null)?.full_name || "Candidate",
        status: a.status,
        lastMessage: last.message,
        lastAt: last.created_at,
        unread,
      });
    }
    built.sort((x, y) => (y.lastAt > x.lastAt ? 1 : -1));
    setRows(built);
    setLoadingList(false);
  };

  useEffect(() => {
    if (!roleLoading) loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, roleLoading]);

  // Realtime: any new/updated message for this company refreshes the list
  // (sidebar badge handles its own subscription independently).
  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel(`employer-inbox-list-${companyId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: FOLLOW_UP_MESSAGES_TABLE },
        () => loadList(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const jobs = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows ?? []) map.set(r.jobId, r.jobTitle);
    return Array.from(map, ([id, title]) => ({ id, title }));
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (jobFilter !== "all") list = list.filter((r) => r.jobId === jobFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) => r.candidateName.toLowerCase().includes(q) || r.jobTitle.toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, jobFilter, search]);

  // A sent/received message in the open chat updates this row's preview
  // immediately, without waiting for the list's own realtime refresh.
  const bumpRow = (
    applicationId: string,
    message: string,
    createdAt: string,
    unreadDelta: number,
  ) => {
    setRows((prev) =>
      (prev ?? [])
        .map((r) =>
          r.applicationId === applicationId
            ? {
                ...r,
                lastMessage: message,
                lastAt: createdAt,
                unread: Math.max(0, r.unread + unreadDelta),
              }
            : r,
        )
        .sort((x, y) => (y.lastAt > x.lastAt ? 1 : -1)),
    );
  };

  const list = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidate or job title"
            className="pl-9"
          />
        </div>
        {jobs.length > 1 && (
          <Select value={jobFilter} onValueChange={setJobFilter}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All jobs</SelectItem>
              {jobs.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loadingList ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : listError ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {listError}
            </p>
            <button
              type="button"
              onClick={loadList}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 px-6 text-center">
            <InboxIcon className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {rows && rows.length === 0
                ? "No follow ups yet. When candidates follow up on your jobs, they will show here."
                : "No chats match your search."}
            </p>
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.applicationId}
              type="button"
              onClick={() => setSelected(r)}
              className={`flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors ${
                selected?.applicationId === r.applicationId
                  ? "bg-primary-light"
                  : "hover:bg-surface"
              }`}
            >
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold text-foreground">
                {r.candidateName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {r.candidateName}
                  </p>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {formatMsgTime(r.lastAt)}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{r.jobTitle}</p>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-foreground/70">{r.lastMessage}</p>
                  {r.unread > 0 && (
                    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                      {r.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <EmployerShell title="Inbox" subtitle="Candidate follow-ups on your jobs.">
      <div className="h-[calc(100vh-180px)] min-h-[480px] overflow-hidden rounded-xl border border-border bg-card">
        {isMobile ? (
          selected ? (
            <ChatPanel chat={selected} onBack={() => setSelected(null)} onMessage={bumpRow} />
          ) : (
            list
          )
        ) : (
          <div className="grid h-full grid-cols-[320px_1fr]">
            <div className="min-h-0 border-r border-border">{list}</div>
            <div className="min-h-0">
              {selected ? (
                <ChatPanel chat={selected} onMessage={bumpRow} />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-muted-foreground">Select a chat to start</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </EmployerShell>
  );
}

function ChatPanel({
  chat,
  onBack,
  onMessage,
}: {
  chat: ChatRow;
  onBack?: () => void;
  onMessage: (
    applicationId: string,
    message: string,
    createdAt: string,
    unreadDelta: number,
  ) => void;
}) {
  const [messages, setMessages] = useState<FollowUpMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await followUpMessagesTable()
      .select(FOLLOW_UP_MESSAGE_SELECT)
      .eq("application_id", chat.applicationId)
      .order("created_at", { ascending: true });
    if (err) {
      setError(err.message || "Could not load the conversation.");
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as FollowUpMessage[];
    setMessages(rows);
    setLoading(false);

    // Opening the chat marks the candidate's messages read.
    const unreadIds = rows
      .filter((m) => m.sender_role === "candidate" && !m.read_at)
      .map((m) => m.id);
    if (unreadIds.length) {
      await followUpMessagesTable()
        .update({ read_at: new Date().toISOString() })
        .in("id", unreadIds);
      onMessage(chat.applicationId, chat.lastMessage, chat.lastAt, -unreadIds.length);
    }
  };

  useEffect(() => {
    setDraft("");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.applicationId]);

  useEffect(() => {
    const channel = supabase
      .channel(`employer-inbox-chat-${chat.applicationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: FOLLOW_UP_MESSAGES_TABLE,
          filter: `application_id=eq.${chat.applicationId}`,
        },
        (payload) => {
          const row = payload.new as FollowUpMessage;
          setMessages((prev) => {
            if (prev?.some((m) => m.id === row.id)) return prev;
            return [...(prev ?? []), row];
          });
          if (row.sender_role === "candidate") {
            void followUpMessagesTable()
              .update({ read_at: new Date().toISOString() })
              .eq("id", row.id);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [chat.applicationId]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) {
      setError("Please sign in again.");
      setSending(false);
      return;
    }
    const { data: row, error: err } = await followUpMessagesTable()
      .insert({
        application_id: chat.applicationId,
        sender_role: "employer",
        sender_id: uid,
        message: body,
      })
      .select(FOLLOW_UP_MESSAGE_SELECT)
      .single();
    if (err) {
      setError(err.message || "Could not send your message. Try again.");
      setSending(false);
      return;
    }
    const sent = row as FollowUpMessage;
    setMessages((prev) => [...(prev ?? []), sent]);
    onMessage(chat.applicationId, sent.message, sent.created_at, 0);
    setDraft("");
    setSending(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to chat list"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{chat.candidateName}</p>
            <Badge
              variant={statusVariant[chat.status] || "muted"}
              className="shrink-0 rounded-full px-2.5 py-0.5 text-xs capitalize"
            >
              {chat.status}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">{chat.jobTitle}</p>
        </div>
        <Link
          to="/employer/jobs/$jobId/applicants"
          params={{ jobId: chat.jobId }}
          className="shrink-0 text-xs font-semibold text-primary hover:underline"
        >
          View application
        </Link>
      </div>

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
      >
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-24 flex-col items-center justify-center gap-2 text-center">
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {error}
            </p>
            <button
              type="button"
              onClick={load}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        ) : !messages || messages.length === 0 ? (
          <div className="flex h-24 items-center justify-center px-4 text-center">
            <p className="text-xs text-muted-foreground">No messages yet.</p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.sender_role === "employer";
            return (
              <div
                key={m.id}
                className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[75%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                  <p className="mb-0.5 text-[10px] text-muted-foreground">
                    {mine ? "You" : chat.candidateName} · {formatMsgTime(m.created_at)}
                  </p>
                  <div
                    className={`rounded-xl px-3 py-2 text-sm ${
                      mine ? "bg-primary-light text-foreground" : "bg-muted text-foreground"
                    }`}
                  >
                    {m.message}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div
        className="shrink-0 border-t border-border px-4 py-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={draft}
            maxLength={MAX_LEN}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Write a reply…"
            className="form-input min-h-0 resize-none"
          />
          <button
            type="button"
            aria-label="Send message"
            disabled={!draft.trim() || sending}
            onClick={send}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1 text-right text-[11px] text-muted-foreground">
          {draft.length}/{MAX_LEN}
        </p>
      </div>
    </div>
  );
}
