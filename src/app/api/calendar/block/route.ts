import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Mirrors a task's time-block into Google Calendar, so accepted work occupies
// real time on the phone Amit actually looks at — and so nobody books a meeting
// over it.
//
// One entry point for all three cases: create, move, and remove. The task's
// scheduled_at is the source of truth; null means the block should not exist.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { taskId } = await request.json().catch(() => ({}));
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

  const [{ data: task }, { data: secrets }, { data: profile }] = await Promise.all([
    supabase.from("tasks").select("id, title, description, scheduled_at, duration_min, due_at, deleted_at, status")
      .eq("id", taskId).maybeSingle(),
    supabase.from("user_secrets")
      .select("google_client_id, google_client_secret, google_refresh_token, calendar_enabled").maybeSingle(),
    supabase.from("profiles").select("timezone").maybeSingle(),
  ]);

  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  if (!secrets?.google_refresh_token) return NextResponse.json({ error: "Google not connected" }, { status: 400 });
  if (!secrets.calendar_enabled) return NextResponse.json({ ok: true, skipped: "calendar disabled" });

  // The existing mirror for this task, if any.
  const { data: existing } = await supabase.from("calendar_events")
    .select("id, external_id").eq("task_id", task.id).maybeSingle();

  const token = await accessToken(secrets);
  if (!token) return NextResponse.json({ error: "Could not refresh Google access" }, { status: 502 });

  const shouldExist = !!task.scheduled_at && !task.deleted_at
    && task.status !== "done" && task.status !== "cancelled";

  // Gone, done, or unscheduled: remove the block rather than leave a lie on the
  // calendar. A 404 or 410 from Google means it is already gone — not an error.
  if (!shouldExist) {
    if (existing?.external_id) {
      const r = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(existing.external_id)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok && r.status !== 404 && r.status !== 410) {
        return NextResponse.json({ error: `Calendar delete failed (${r.status})` }, { status: 502 });
      }
      await supabase.from("calendar_events").delete().eq("id", existing.id);
    }
    return NextResponse.json({ ok: true, action: "removed" });
  }

  const tz = profile?.timezone ?? "Asia/Kolkata";
  const start = new Date(task.scheduled_at!);
  const end = new Date(start.getTime() + (task.duration_min ?? 30) * 60_000);

  const body = {
    summary: task.title,
    description: [
      task.description ?? "",
      task.due_at ? `Due: ${new Date(task.due_at).toLocaleString("en-IN", { timeZone: tz })}` : "",
      "Time-blocked by Tracker.",
    ].filter(Boolean).join("\n\n"),
    start: { dateTime: start.toISOString(), timeZone: tz },
    end: { dateTime: end.toISOString(), timeZone: tz },
    // Focus time, not a meeting: no invites, and free/busy stays transparent to
    // nobody but Amit.
    transparency: "opaque",
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] },
    // Lets the block be recognised as ours on the way back in, independently of
    // our own database.
    extendedProperties: { private: { trackerTaskId: task.id } },
  };

  const url = existing?.external_id
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(existing.external_id)}`
    : "https://www.googleapis.com/calendar/v3/calendars/primary/events";

  const r = await fetch(url, {
    method: existing?.external_id ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();

  // The stored event was deleted in Google behind our back: drop the stale
  // mapping and create a fresh one rather than failing.
  if (!r.ok && (r.status === 404 || r.status === 410) && existing) {
    await supabase.from("calendar_events").delete().eq("id", existing.id);
    return POST(new Request(request.url, { method: "POST", body: JSON.stringify({ taskId }) }));
  }
  if (!r.ok) return NextResponse.json({ error: `Calendar write failed: ${j?.error?.message ?? r.status}` }, { status: 502 });

  await supabase.from("calendar_events").upsert({
    user_id: user.id, calendar_id: "primary", external_id: j.id,
    title: task.title, start_at: start.toISOString(), end_at: end.toISOString(),
    all_day: false, status: "confirmed", html_link: j.htmlLink ?? null,
    task_id: task.id, updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,calendar_id,external_id" });

  return NextResponse.json({ ok: true, action: existing ? "updated" : "created", link: j.htmlLink ?? null });
}

async function accessToken(s: { google_client_id: string; google_client_secret: string; google_refresh_token: string }) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: s.google_client_id, client_secret: s.google_client_secret,
      refresh_token: s.google_refresh_token, grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  return j.access_token as string | undefined;
}
