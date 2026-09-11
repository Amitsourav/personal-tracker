// Supabase Edge Function: mirrors Google Calendar into calendar_events.
//
// Read-only for now. The planner cannot propose a sensible day without knowing
// when Amit is already busy, so this is the foundation the rest of Phase 5 sits
// on. Writing tasks back as calendar entries comes later.
//
// Uses Google's syncToken so each run transfers only what changed. Google
// expires sync tokens (410 GONE) after a while or on calendar changes; that is
// expected, and the function falls back to a full window automatically.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WINDOW_DAYS_BACK = 1;
const WINDOW_DAYS_FWD = 21;

type Secrets = {
  user_id: string; google_client_id: string; google_client_secret: string;
  google_refresh_token: string; google_email: string | null;
  calendar_enabled: boolean; calendar_sync_token: string | null;
};
type GEvent = {
  id: string; status?: string; summary?: string; description?: string; location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string };
  attendees?: { email?: string; self?: boolean; responseStatus?: string; displayName?: string }[];
};

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization")?.replace(/^Bearer /i, "").trim() ?? "";
  if (!auth) return json({ error: "unauthorized" }, 401);
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let userIds: string[] = [];
  if (auth === SERVICE_KEY) {
    const { data } = await db.from("user_secrets").select("user_id")
      .eq("calendar_enabled", true).not("google_refresh_token", "is", null);
    userIds = (data ?? []).map((r: { user_id: string }) => r.user_id);
  } else {
    const { data: uid } = await db.rpc("user_by_sync_token", { tok: auth });
    if (!uid) return json({ error: "unauthorized" }, 401);
    userIds = [uid as string];
  }

  const body = await req.json().catch(() => ({}));
  const full = body?.full === true;

  const results: Record<string, unknown>[] = [];
  for (const uid of userIds) {
    try { results.push(await runForUser(db, uid, full)); }
    catch (e) { console.error("sync-calendar", uid, e); results.push({ user: uid, error: String(e) }); }
  }
  return json(results.length === 1 ? results[0] : { runs: results });
});

async function runForUser(db: SupabaseClient, uid: string, full: boolean) {
  const { data: s } = await db.from("user_secrets").select("*").eq("user_id", uid).single();
  const sec = s as Secrets;
  if (!sec?.calendar_enabled) return { skipped: "calendar disabled" };
  if (!sec.google_refresh_token) return { error: "Google not connected" };

  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: sec.google_client_id, client_secret: sec.google_client_secret,
      refresh_token: sec.google_refresh_token, grant_type: "refresh_token",
    }),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) return { error: `Google token: ${tok.error_description ?? tok.error ?? "failed"}` };

  const selfEmail = (sec.google_email ?? "").toLowerCase();
  let syncToken = full ? null : sec.calendar_sync_token;
  let events: GEvent[] = [];
  let nextSyncToken: string | null = null;
  let pageToken: string | undefined;
  let usedFullWindow = false;

  for (let page = 0; page < 10; page++) {
    const params: Record<string, string> = { maxResults: "250", singleEvents: "true" };
    if (syncToken) {
      params.syncToken = syncToken;
    } else {
      // A full window is bounded: the planner never looks further than three
      // weeks out, and pulling a lifetime of history would be pointless volume.
      usedFullWindow = true;
      params.timeMin = new Date(Date.now() - WINDOW_DAYS_BACK * 86_400_000).toISOString();
      params.timeMax = new Date(Date.now() + WINDOW_DAYS_FWD * 86_400_000).toISOString();
      params.orderBy = "startTime";
    }
    if (pageToken) params.pageToken = pageToken;

    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams(params)}`,
      { headers: { Authorization: `Bearer ${tok.access_token}` } });
    const j = await r.json();

    // 410 GONE: the sync token expired. Documented and routine — start over with
    // a full window rather than treating it as an error.
    if (r.status === 410) { syncToken = null; pageToken = undefined; events = []; continue; }
    if (!r.ok) return { error: `Calendar: ${j?.error?.message ?? r.status}` };

    events = events.concat(j.items ?? []);
    if (j.nextPageToken) { pageToken = j.nextPageToken; continue; }
    nextSyncToken = j.nextSyncToken ?? null;
    break;
  }

  let upserted = 0, cancelled = 0;
  for (const e of events) {
    if (!e.id) continue;
    // An incremental sync reports deletions as status:cancelled with no times.
    if (e.status === "cancelled") {
      await db.from("calendar_events").update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("user_id", uid).eq("calendar_id", "primary").eq("external_id", e.id);
      cancelled++;
      continue;
    }

    const allDay = !!e.start?.date;
    const startAt = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null);
    const endAt = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : null);
    if (!startAt || !endAt) continue;

    const self = (e.attendees ?? []).find(a => a.self || (a.email ?? "").toLowerCase() === selfEmail);

    const { error } = await db.from("calendar_events").upsert({
      user_id: uid, calendar_id: "primary", external_id: e.id,
      title: e.summary ?? "(no title)", description: e.description ?? null, location: e.location ?? null,
      start_at: startAt, end_at: endAt, all_day: allDay,
      status: e.status ?? "confirmed",
      self_response: self?.responseStatus ?? null,
      organizer: e.organizer?.email ?? null,
      attendees: (e.attendees ?? []).map(a => ({ email: a.email, name: a.displayName, response: a.responseStatus })),
      html_link: e.htmlLink ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,calendar_id,external_id" });
    if (error) console.error("event upsert failed", JSON.stringify(error));
    else upserted++;
  }

  await db.from("user_secrets").update({
    calendar_sync_token: nextSyncToken ?? sec.calendar_sync_token,
    calendar_last_sync_at: new Date().toISOString(),
  }).eq("user_id", uid);

  return { upserted, cancelled, full_window: usedFullWindow, incremental: !usedFullWindow };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
