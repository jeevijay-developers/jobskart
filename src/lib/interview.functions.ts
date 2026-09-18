import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { verifyInterviewJoinToken } from "@/lib/interview-token.server";
import { getJoinWindowState } from "@/lib/interview-window";
import type { Database } from "@/integrations/supabase/types";

type InterviewRow = Database["public"]["Tables"]["interviews"]["Row"];
type InterviewZoomSecretsRow = Database["public"]["Tables"]["interview_zoom_secrets"]["Row"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertCompanyMember(supabase: any, userId: string, companyId: string) {
  const { data, error } = await supabase
    .from("employer_members")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You don't have access to this company.");
}

function interviewTopic(jobTitle: string | null): string {
  return jobTitle ? `JobsKart Interview – ${jobTitle}` : "JobsKart Interview";
}

// A jobskart_zoom interview always has a secrets row (attach happens in the
// same scheduling flow right after reserve_video_interview_slot succeeds),
// so a missing row here means data got corrupted, not a normal "not yet" state.
async function requireZoomSecrets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  interviewId: string,
): Promise<InterviewZoomSecretsRow> {
  const { data, error } = await supabaseAdmin
    .from("interview_zoom_secrets")
    .select("*")
    .eq("interview_id", interviewId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Video call details are missing for this interview. Contact support.");
  return data as InterviewZoomSecretsRow;
}

// ---------------- scheduleInterview ----------------
export const scheduleInterview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        companyId: z.string().uuid(),
        applicationId: z.string().uuid(),
        scheduledAt: z.string().datetime(),
        durationMin: z.number().int().positive().max(240),
        provider: z.enum(["jobskart_zoom", "external_link"]),
        mode: z.enum(["video", "phone", "onsite"]),
        location: z.string().trim().min(1).optional(),
        meetingUrl: z.string().url().optional(),
        notes: z.string().trim().min(1).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let hostUserId: string | null = null;
    if (data.provider === "jobskart_zoom") {
      const { getZoomHostUserId } = await import("@/lib/zoom/client.server");
      hostUserId = getZoomHostUserId();
    }

    const { data: interview, error: reserveErr } = await supabaseAdmin.rpc(
      "reserve_video_interview_slot",
      {
        _application_id: data.applicationId,
        _scheduled_at: data.scheduledAt,
        _duration_min: data.durationMin,
        _provider: data.provider,
        _mode: data.mode,
        _location: data.location ?? undefined,
        _meeting_url: data.meetingUrl ?? undefined,
        _notes: data.notes ?? undefined,
        _host_user_id: hostUserId ?? undefined,
        _actor: context.userId,
      },
    );
    if (reserveErr) throw new Error(reserveErr.message);
    const reserved = interview as unknown as InterviewRow;

    if (data.provider === "jobskart_zoom") {
      const zoomHostUserId = hostUserId!;
      try {
        const { createZoomMeeting } = await import("@/lib/zoom/client.server");
        const { data: job } = reserved.job_id
          ? await supabaseAdmin.from("jobs").select("title").eq("id", reserved.job_id).maybeSingle()
          : { data: null };

        const meeting = await createZoomMeeting({
          hostUserId: zoomHostUserId,
          topic: interviewTopic(job?.title ?? null),
          startTimeIso: data.scheduledAt,
          durationMin: data.durationMin,
        });

        const { error: attachErr } = await supabaseAdmin.rpc("attach_zoom_meeting_secrets", {
          _interview_id: reserved.id,
          _zoom_meeting_id: meeting.id,
          _zoom_meeting_uuid: meeting.uuid,
          _zoom_password: meeting.password,
          _zoom_host_user_id: zoomHostUserId,
          _zoom_start_url: meeting.startUrl,
          _zoom_join_url: meeting.joinUrl,
        });
        if (attachErr) throw new Error(attachErr.message);
      } catch (zoomErr) {
        // Compensating action: release the reserved slot so the single host
        // account isn't left holding a dead reservation. DB cancel is
        // authoritative here regardless of whether Zoom partially succeeded.
        await supabaseAdmin.rpc("cancel_video_interview", {
          _interview_id: reserved.id,
          _reason: "zoom_creation_failed",
          _actor: context.userId,
        });
        const message = zoomErr instanceof Error ? zoomErr.message : String(zoomErr);
        throw new Error(`Couldn't set up the video call, please try again. (${message})`);
      }
    }

    // Email 1 — immediate confirmation, no join link/password (see
    // interviewScheduledEmail's doc comment). Fire-and-forget: scheduling has
    // already succeeded and is the source of truth, so an email hiccup here
    // must never surface as a scheduling failure.
    supabaseAdmin.functions
      .invoke("interview-scheduled", { body: { interviewId: reserved.id } })
      .catch((e: unknown) => console.error("interview-scheduled invoke failed", e));

    return {
      id: reserved.id,
      scheduledAt: reserved.scheduled_at,
      durationMin: reserved.duration_min,
      provider: reserved.provider,
      mode: reserved.mode,
      status: reserved.status,
    };
  });

// ---------------- rescheduleInterview ----------------
export const rescheduleInterview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        companyId: z.string().uuid(),
        interviewId: z.string().uuid(),
        newScheduledAt: z.string().datetime(),
        newDurationMin: z.number().int().positive().max(240).optional(),
        notes: z.string().trim().min(1).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: updated, error } = await supabaseAdmin.rpc("reschedule_video_interview", {
      _interview_id: data.interviewId,
      _new_scheduled_at: data.newScheduledAt,
      _new_duration_min: data.newDurationMin ?? undefined,
      _notes: data.notes ?? undefined,
      _actor: context.userId,
    });
    if (error) throw new Error(error.message);
    const iv = updated as unknown as InterviewRow;

    if (iv.provider === "jobskart_zoom") {
      try {
        const secrets = await requireZoomSecrets(supabaseAdmin, iv.id);
        const { updateZoomMeeting } = await import("@/lib/zoom/client.server");
        await updateZoomMeeting(secrets.zoom_meeting_id, {
          startTimeIso: data.newScheduledAt,
          durationMin: iv.duration_min,
        });
      } catch (zoomErr) {
        // The DB reschedule already succeeded and is source of truth for the
        // in-app room (join creds are re-signed at join time, not read off
        // Zoom's own stored start_time), so a Zoom-side update failure here
        // is logged, not thrown — matches CLAUDE.md's "no third-party
        // failure blocks a core flow".
        console.error("Zoom updateMeeting failed during reschedule", zoomErr);
      }
    }

    return {
      id: iv.id,
      scheduledAt: iv.scheduled_at,
      durationMin: iv.duration_min,
      status: iv.status,
    };
  });

// ---------------- cancelInterview ----------------
export const cancelInterview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        companyId: z.string().uuid(),
        interviewId: z.string().uuid(),
        reason: z.string().trim().min(1).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: cancelled, error } = await supabaseAdmin.rpc("cancel_video_interview", {
      _interview_id: data.interviewId,
      _reason: data.reason ?? undefined,
      _actor: context.userId,
    });
    if (error) throw new Error(error.message);
    const iv = cancelled as unknown as InterviewRow;

    if (iv.provider === "jobskart_zoom") {
      try {
        const { data: secrets } = await supabaseAdmin
          .from("interview_zoom_secrets")
          .select("zoom_meeting_id")
          .eq("interview_id", iv.id)
          .maybeSingle();
        if (secrets?.zoom_meeting_id) {
          const { deleteZoomMeeting } = await import("@/lib/zoom/client.server");
          await deleteZoomMeeting(secrets.zoom_meeting_id);
        }
      } catch (zoomErr) {
        console.error("Zoom deleteMeeting failed during cancel", zoomErr);
      }
    }

    return { id: iv.id, status: iv.status };
  });

// ---------------- getHostStartUrl (v1 "Join as Host") ----------------
// Opens the native Zoom app/web client directly via Zoom's own start_url,
// rather than the branded in-app embedded viewport described in the
// architecture plan (Bottleneck 2.2's isolated Meeting SDK viewport). That
// viewport is a separate, larger piece of work; this gives employers a fully
// functional host join now without a live Zoom API round-trip — start_url is
// already stored locally from meeting creation, so this never calls Zoom.
export const getHostStartUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ companyId: z.string().uuid(), interviewId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertCompanyMember(context.supabase, context.userId, data.companyId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: iv, error } = await supabaseAdmin
      .from("interviews")
      .select("id, provider, status")
      .eq("id", data.interviewId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!iv) throw new Error("Interview not found.");
    if (iv.provider !== "jobskart_zoom")
      throw new Error("This interview isn't a platform video call.");
    if (iv.status === "cancelled" || iv.status === "completed") {
      throw new Error("This interview is no longer active.");
    }

    const secrets = await requireZoomSecrets(supabaseAdmin, iv.id);
    if (!secrets.zoom_start_url) throw new Error("Host link isn't available for this interview.");
    return { startUrl: secrets.zoom_start_url };
  });

// Shared payload builder for both candidate join paths below.
async function buildCandidateJoinPayload(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  iv: InterviewRow,
) {
  const windowState = getJoinWindowState(iv.scheduled_at, iv.duration_min);

  const { data: job } = await supabaseAdmin
    .from("jobs")
    .select("title")
    .eq("id", iv.job_id)
    .maybeSingle();
  const { data: company } = await supabaseAdmin
    .from("companies")
    .select("name")
    .eq("id", iv.company_id)
    .maybeSingle();

  const base = {
    windowState,
    provider: iv.provider,
    mode: iv.mode,
    scheduledAt: iv.scheduled_at,
    durationMin: iv.duration_min,
    jobTitle: job?.title ?? null,
    companyName: company?.name ?? null,
  };

  if (windowState !== "open") {
    return base;
  }

  if (iv.provider === "external_link") {
    return { ...base, meetingUrl: iv.meeting_url, zoomAppDeepLink: null };
  }

  // v1 join path: Zoom's own join_url (already stored from meeting creation,
  // no live Zoom API call needed) plus a zoomus:// deep link for the "open in
  // Zoom app" mobile button in interview-join.tsx — same pragmatic choice as
  // getHostStartUrl above, ahead of the fully embedded/isolated SDK viewport.
  const secrets = await requireZoomSecrets(supabaseAdmin, iv.id);
  const zoomAppDeepLink = `zoomus://zoom.us/join?confno=${encodeURIComponent(secrets.zoom_meeting_id)}&pwd=${encodeURIComponent(secrets.zoom_password)}`;

  return {
    ...base,
    meetingUrl: secrets.zoom_join_url,
    zoomAppDeepLink,
  };
}

// ---------------- getCandidateJoinPayloadByToken (no auth — HMAC-gated) ----------------
export const getCandidateJoinPayloadByToken = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ token: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const verified = verifyInterviewJoinToken(data.token);
    if (!verified.ok) throw new Error(`invalid_join_link:${verified.reason}`);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: iv, error } = await supabaseAdmin
      .from("interviews")
      .select("*")
      .eq("id", verified.payload.interviewId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!iv || iv.candidate_id !== verified.payload.candidateId) {
      throw new Error("invalid_join_link:not_found");
    }
    if (iv.status === "cancelled" || iv.status === "completed") {
      throw new Error("This interview is no longer active.");
    }

    return buildCandidateJoinPayload(supabaseAdmin, iv as InterviewRow);
  });

// ---------------- getCandidateJoinPayloadForOwnInterview (authenticated candidate) ----------------
export const getCandidateJoinPayloadForOwnInterview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ interviewId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // RLS ("candidate reads own interviews") already scopes this to the
    // caller, so a row coming back at all is proof of ownership.
    const { data: iv, error } = await context.supabase
      .from("interviews")
      .select("*")
      .eq("id", data.interviewId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!iv) throw new Error("Interview not found.");
    if (iv.status === "cancelled" || iv.status === "completed") {
      throw new Error("This interview is no longer active.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return buildCandidateJoinPayload(supabaseAdmin, iv as InterviewRow);
  });
