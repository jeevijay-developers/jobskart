// Server-only. All Zoom Server-to-Server OAuth / REST calls live in this one
// file — mirrors the AI-provider isolation rule in CLAUDE.md (src/lib/ai/provider.ts):
// no other file should hardcode a Zoom URL or read ZOOM_* env vars directly.
//
// v1 targets a single platform host account (ZOOM_HOST_USER_ID). See the
// design note at the top of supabase/migrations/20260917123602_interview_zoom_scheduling.sql
// for why a multi-host pool isn't built yet.

const ZOOM_OAUTH_URL = "https://zoom.us/oauth/token";
const ZOOM_API_BASE = "https://api.zoom.us/v2";

type ZoomS2SConfig = {
  accountId: string;
  clientId: string;
  clientSecret: string;
  hostUserId: string;
};

function readZoomS2SConfig(): ZoomS2SConfig | null {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  const hostUserId = process.env.ZOOM_HOST_USER_ID;
  if (!accountId || !clientId || !clientSecret || !hostUserId) return null;
  return { accountId, clientId, clientSecret, hostUserId };
}

export function isZoomConfigured(): boolean {
  return readZoomS2SConfig() !== null;
}

/** Throws a friendly, admin-facing error if Zoom S2S credentials aren't set. */
export function getZoomHostUserId(): string {
  const config = readZoomS2SConfig();
  if (!config) {
    throw new Error(
      "Platform video interviews aren't configured yet. Ask the admin to add ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, and ZOOM_HOST_USER_ID.",
    );
  }
  return config.hostUserId;
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const config = readZoomS2SConfig();
  if (!config) throw new Error("Zoom not configured.");

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.accessToken;
  }

  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetch(
    `${ZOOM_OAUTH_URL}?grant_type=account_credentials&account_id=${config.accountId}`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${auth}` },
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zoom OAuth token request failed (${res.status}). ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

async function zoomFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${ZOOM_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

export type ZoomMeeting = {
  id: string;
  uuid: string;
  password: string;
  startUrl: string;
  joinUrl: string;
};

export async function createZoomMeeting(params: {
  hostUserId: string;
  topic: string;
  startTimeIso: string;
  durationMin: number;
}): Promise<ZoomMeeting> {
  const res = await zoomFetch(`/users/${encodeURIComponent(params.hostUserId)}/meetings`, {
    method: "POST",
    body: JSON.stringify({
      topic: params.topic,
      type: 2, // scheduled meeting
      start_time: params.startTimeIso,
      duration: params.durationMin,
      timezone: "Asia/Kolkata",
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: false,
        waiting_room: true,
        approval_type: 2, // no registration required
        audio: "both",
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zoom create-meeting failed (${res.status}). ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    id: number;
    uuid: string;
    password: string;
    start_url: string;
    join_url: string;
  };
  return {
    id: String(data.id),
    uuid: data.uuid,
    password: data.password,
    startUrl: data.start_url,
    joinUrl: data.join_url,
  };
}

export async function updateZoomMeeting(
  meetingId: string,
  params: { startTimeIso: string; durationMin: number },
): Promise<void> {
  const res = await zoomFetch(`/meetings/${encodeURIComponent(meetingId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      start_time: params.startTimeIso,
      duration: params.durationMin,
      timezone: "Asia/Kolkata",
    }),
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zoom update-meeting failed (${res.status}). ${text.slice(0, 300)}`);
  }
}

/** Best-effort: caller should catch and log rather than let this block a DB-side cancel. */
export async function deleteZoomMeeting(meetingId: string): Promise<void> {
  const res = await zoomFetch(`/meetings/${encodeURIComponent(meetingId)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zoom delete-meeting failed (${res.status}). ${text.slice(0, 300)}`);
  }
}
