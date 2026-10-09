import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Briefcase,
  Building2,
  Calendar,
  Check,
  Copy,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Send,
  X,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatSalary } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import {
  FOLLOW_UP_MESSAGES_TABLE,
  FOLLOW_UP_MESSAGE_SELECT,
  followUpMessagesTable,
  type FollowUpMessage,
} from "@/lib/applicationFollowUp";

const MAX_LEN = 500;

function defaultDraft(jobTitle: string) {
  return `Hi, I had applied for the ${jobTitle} position. I wanted to check if there are any updates on my application. Thank you!`;
}

// One draft per application so switching between two "Follow up" clicks never
// shows a half-typed message meant for a different job.
const drafts = new Map<string, string>();

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

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — no-op */
        }
      }}
      aria-label={copied ? "Copied" : "Copy"}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  applicationId: string;
  phone?: string | null;
  email?: string | null;
  jobTitle: string;
  companyName: string;
  city?: string | null;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string | null;
  appliedOn: string;
  status: string;
  statusVariant?: BadgeProps["variant"];
};

/**
 * Applications → Follow up: a real conversation thread for one application,
 * backed by application_follow_up_messages (candidate reads/sends here; the
 * same table/RLS let the employer Inbox read/reply — see
 * 20261009120000_application_follow_up_messages.sql). Realtime so an
 * employer reply appears without a refresh. Design/layout unchanged from the
 * previous pass: header+close, job summary, contact details, conversation
 * log, pinned composer.
 */
export function FollowUpDialog({
  open,
  onClose,
  applicationId,
  phone,
  email,
  jobTitle,
  companyName,
  city,
  minSalary,
  maxSalary,
  salaryPeriod,
  appliedOn,
  status,
  statusVariant,
}: Props) {
  const isMobile = useIsMobile();

  const [messages, setMessages] = useState<FollowUpMessage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(() => drafts.get(applicationId) ?? defaultDraft(jobTitle));
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await followUpMessagesTable()
      .select(FOLLOW_UP_MESSAGE_SELECT)
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true });
    if (error) {
      setLoadError(error.message || "Could not load the conversation.");
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as FollowUpMessage[];
    setMessages(rows);
    setLoading(false);

    // Mark the employer's unread messages read now that the candidate has
    // opened this thread (RLS: "candidate marks employer messages read").
    const unreadIds = rows
      .filter((m) => m.sender_role === "employer" && !m.read_at)
      .map((m) => m.id);
    if (unreadIds.length) {
      await followUpMessagesTable()
        .update({ read_at: new Date().toISOString() })
        .in("id", unreadIds);
    }
  };

  useEffect(() => {
    if (!open) return;
    setDraft(drafts.get(applicationId) ?? defaultDraft(jobTitle));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, applicationId]);

  // Realtime: new employer replies (or read receipts) land here live.
  useEffect(() => {
    if (!open) return;
    const channel = supabase
      .channel(`follow-up-${applicationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: FOLLOW_UP_MESSAGES_TABLE,
          filter: `application_id=eq.${applicationId}`,
        },
        (payload) => {
          const row = payload.new as FollowUpMessage;
          setMessages((prev) => {
            if (prev?.some((m) => m.id === row.id)) return prev;
            return [...(prev ?? []), row];
          });
          if (row.sender_role === "employer") {
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
  }, [open, applicationId]);

  useEffect(() => {
    if (!open) return;
    drafts.set(applicationId, draft);
  }, [draft, applicationId, open]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user.id;
    if (!uid) {
      setLoadError("Please sign in again.");
      setSending(false);
      return;
    }
    const { data: row, error } = await followUpMessagesTable()
      .insert({
        application_id: applicationId,
        sender_role: "candidate",
        sender_id: uid,
        message: body,
      })
      .select(FOLLOW_UP_MESSAGE_SELECT)
      .single();
    if (error) {
      setLoadError(error.message || "Could not send your message. Try again.");
      setSending(false);
      return;
    }
    setMessages((prev) => [...(prev ?? []), row as FollowUpMessage]);
    drafts.delete(applicationId);
    setDraft("");
    setSending(false);
  };

  const contactItems = useMemo(
    () =>
      [
        phone ? { key: "call", label: "Call", icon: Phone, value: phone, copy: true } : null,
        email ? { key: "email", label: "Email", icon: Mail, value: email, copy: true } : null,
        phone
          ? { key: "whatsapp", label: "WhatsApp", icon: MessageSquare, value: phone, copy: false }
          : null,
      ].filter(
        (
          x,
        ): x is { key: string; label: string; icon: typeof Phone; value: string; copy: boolean } =>
          !!x,
      ),
    [phone, email],
  );

  const body = (
    <>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 id="follow-up-title" className="text-base font-bold text-foreground">
            Follow up with employer
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Send a quick, polite check-in about this application.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {/* Job summary */}
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-light text-sm font-bold text-primary">
            {companyName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
                <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {jobTitle}
              </p>
              <Badge
                variant={statusVariant || "info"}
                className="shrink-0 rounded-full px-2.5 py-0.5 text-xs capitalize"
              >
                {status}
              </Badge>
            </div>
            <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 shrink-0" /> {companyName}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {city ? (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {city}
                </span>
              ) : null}
              {minSalary || maxSalary ? (
                <span className="font-medium text-foreground">
                  {formatSalary(minSalary ?? null, maxSalary ?? null, salaryPeriod || "monthly")}
                </span>
              ) : null}
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" /> Applied {appliedOn}
              </span>
            </div>
          </div>
        </div>

        {/* Contact details */}
        {contactItems.length > 0 && (
          <div className="mt-4 grid gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-3">
            {contactItems.map((c) => {
              const Icon = c.icon;
              return (
                <div
                  key={c.key}
                  className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-card px-2.5 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {c.label}
                      </p>
                      <p className="truncate text-xs font-medium text-foreground">{c.value}</p>
                    </div>
                  </div>
                  {c.copy ? <CopyButton value={c.value} /> : null}
                </div>
              );
            })}
          </div>
        )}

        {/* Conversation */}
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Conversation
          </p>
          <div
            ref={listRef}
            role="log"
            aria-live="polite"
            className="max-h-64 min-h-[120px] space-y-3 overflow-y-auto rounded-xl border border-border bg-surface p-3"
          >
            {loading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : loadError ? (
              <div className="flex h-24 flex-col items-center justify-center gap-2 text-center">
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" /> {loadError}
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
                <p className="text-xs text-muted-foreground">
                  No messages yet. Send your first follow up below.
                </p>
              </div>
            ) : (
              messages.map((m) => {
                const mine = m.sender_role === "candidate";
                return (
                  <div
                    key={m.id}
                    className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}
                  >
                    {!mine && (
                      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                        HR
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] ${mine ? "items-end" : "items-start"} flex flex-col`}
                    >
                      <p className="mb-0.5 text-[10px] text-muted-foreground">
                        {mine ? "You" : `HR Team (${companyName})`} · {formatMsgTime(m.created_at)}
                      </p>
                      <div
                        className={`rounded-xl px-3 py-2 text-sm ${
                          mine ? "bg-primary-light text-foreground" : "bg-muted text-foreground"
                        }`}
                      >
                        {m.message}
                      </div>
                    </div>
                    {mine && (
                      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        You
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Composer — pinned, never scrolls away */}
      <div
        className="shrink-0 border-t border-border px-5 py-4"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mb-1.5 flex items-center justify-between">
          <label htmlFor="follow-up-composer" className="text-xs font-semibold text-foreground">
            Send a follow up message
          </label>
          <span className="text-[11px] text-muted-foreground">
            {draft.length}/{MAX_LEN}
          </span>
        </div>
        <textarea
          id="follow-up-composer"
          rows={3}
          value={draft}
          maxLength={MAX_LEN}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Write a follow-up message…"
          className="form-input resize-none"
        />
        <div className="mt-3 flex gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-surface sm:flex-none"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!draft.trim() || sending}
            onClick={send}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50 sm:flex-none"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send message
          </button>
        </div>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
        <DrawerContent
          aria-labelledby="follow-up-title"
          className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0"
        >
          {body}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-labelledby="follow-up-title"
        className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-[560px] flex-col gap-0 overflow-hidden p-0 [&>button]:hidden"
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}
