// Supabase Edge Function: the morning nudge to team members.
//
// Runs at 09:00 IST, Monday to Saturday (pg_cron, `team-reminders-daily`).
// Each team member gets at most ONE email a morning, listing whatever of
// theirs is due today, due tomorrow, or overdue — one message to read rather
// than one per task, which is how reminders get filtered to a folder.
//
// Overdue work is mentioned on days 1, 3, 7 and 14 past the deadline and then
// left alone; past that it needs Amit, not another automated email. Work sent
// for review is skipped: it is waiting on him.
//
// Sent from Amit's Gmail with the X-Tracker header, so the promise scanner
// (which reads his sent mail) does not mistake a reminder for a promise.
// Authenticates like the other cron functions: the sync token, or the service
// key for all users at once.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const APP = "https://personal-tracker-eta-six.vercel.app";
const OVERDUE_DAYS = [1, 3, 7, 14];

type Kind = "due_today" | "due_tomorrow" | "overdue";
type Row = { id: string; title: string; due_at: string; assignee_id: string; status: string };
type Member = { id: string; name: string; email: string };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = req.headers.get("Authorization")?.replace(/^Bearer /i, "").trim() ?? "";
  if (!auth) return json({ error: "unauthorized" }, 401);
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let userIds: string[] = [];
  if (auth === SERVICE_KEY) {
    const { data } = await db.from("user_secrets").select("user_id")
      .eq("team_reminders_enabled", true).not("google_refresh_token", "is", null);
    userIds = (data ?? []).map((r: { user_id: string }) => r.user_id);
  } else {
    const { data: uid } = await db.rpc("user_by_sync_token", { tok: auth });
    if (!uid) return json({ error: "unauthorized" }, 401);
    userIds = [uid as string];
  }

  const results: Record<string, unknown>[] = [];
  for (const uid of userIds) {
    try { results.push(await runForUser(db, uid)); }
    catch (e) { console.error("team-reminders", uid, e); results.push({ user: uid, error: String(e) }); }
  }
  return json(results.length === 1 ? results[0] : { runs: results });
});

async function runForUser(db: SupabaseClient, uid: string) {
  const [{ data: sec }, { data: profile }] = await Promise.all([
    db.from("user_secrets").select("google_client_id, google_client_secret, google_refresh_token, google_scopes, team_reminders_enabled")
      .eq("user_id", uid).single(),
    db.from("profiles").select("display_name, timezone, work_days").eq("id", uid).single(),
  ]);
  if (!sec?.team_reminders_enabled) return { skipped: "reminders off" };
  if (!sec.google_refresh_token || !(sec.google_scopes ?? []).includes(SEND_SCOPE)) return { skipped: "Gmail sending not allowed" };

  const tz = profile?.timezone ?? "Asia/Kolkata";
  const today = localDate(new Date(), tz);
  // Cron already skips Sundays; this covers a work week set differently.
  const weekday = new Date(today + "T12:00:00Z").getUTCDay();
  if (profile?.work_days && !profile.work_days.includes(weekday)) return { skipped: "not a working day" };
  const tomorrow = addDays(today, 1);

  const [{ data: members }, { data: tasks }, { data: already }] = await Promise.all([
    db.from("team_members").select("id, name, email").eq("owner_id", uid).is("removed_at", null),
    db.from("tasks").select("id, title, due_at, assignee_id, status")
      .eq("user_id", uid).not("assignee_id", "is", null).not("due_at", "is", null)
      .is("deleted_at", null).eq("review_state", "accepted").in("status", ["inbox", "todo", "in_progress", "waiting"]),
    db.from("team_reminders").select("task_id, kind").eq("owner_id", uid).eq("sent_on", today),
  ]);
  const sentToday = new Set((already ?? []).map((r: { task_id: string; kind: string }) => `${r.task_id}:${r.kind}`));

  // What to say about each task today, if anything.
  const due: Record<string, { t: Row; kind: Kind; late: number }[]> = {};
  for (const t of (tasks ?? []) as Row[]) {
    const d = localDate(new Date(t.due_at), tz);
    let kind: Kind | null = null, late = 0;
    if (d === today) kind = "due_today";
    else if (d === tomorrow) kind = "due_tomorrow";
    else if (d < today) { late = daysBetween(d, today); if (OVERDUE_DAYS.includes(late)) kind = "overdue"; }
    if (!kind || sentToday.has(`${t.id}:${kind}`)) continue;
    (due[t.assignee_id] ??= []).push({ t, kind, late });
  }
  if (!Object.keys(due).length) return { sent: 0 };

  const token = await accessToken(sec);
  if (!token) return { error: "Could not refresh Google access" };
  const me = profile?.display_name?.trim() || "Amit";

  let sent = 0;
  for (const m of (members ?? []) as Member[]) {
    const items = due[m.id];
    if (!items?.length) continue;
    const order: Kind[] = ["overdue", "due_today", "due_tomorrow"];
    items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.late - a.late);
    const line = (x: typeof items[number]) =>
      `  • ${x.t.title} — ${x.kind === "overdue" ? `overdue by ${x.late} day${x.late === 1 ? "" : "s"}` : x.kind === "due_today" ? "due today" : "due tomorrow"}`;
    const lateN = items.filter(x => x.kind === "overdue").length;
    const subject = lateN
      ? `Reminder: ${lateN} overdue task${lateN === 1 ? "" : "s"}`
      : `Reminder: ${items.length} task${items.length === 1 ? "" : "s"} due soon`;
    const body = `Hi ${m.name.split(" ")[0]},\n\nA quick reminder:\n\n${items.map(line).join("\n")}\n\n` +
      `If something is stuck or the date won't work, reply on the task in Tracker so I know: ${APP}/login\n\n` +
      `${me}\n\n(Automatic reminder from Tracker)`;

    const ok = await sendMail(token, m, subject, body);
    if (!ok) continue;
    sent++;
    await db.from("team_reminders").insert(items.map(x => ({ task_id: x.t.id, owner_id: uid, kind: x.kind, sent_on: today })));
    await db.from("task_comments").insert(items.map(x => ({
      task_id: x.t.id, owner_id: uid, author_id: null, kind: "reminder", seen_at: new Date().toISOString(),
      body: x.kind === "overdue" ? `overdue by ${x.late} day${x.late === 1 ? "" : "s"}` : x.kind === "due_today" ? "due today" : "due tomorrow",
    })));
  }
  return { sent };
}

async function sendMail(token: string, m: Member, subject: string, body: string) {
  const enc = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const name = /^[\w .'-]+$/.test(m.name) ? `"${m.name}"` : `=?UTF-8?B?${enc(m.name)}?=`;
  const mime = [
    `To: ${name} <${m.email}>`,
    `Subject: =?UTF-8?B?${enc(subject)}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "X-Tracker: reminder",
    "",
    enc(body),
  ].join("\r\n");
  const raw = enc(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!r.ok) console.error("team-reminders send", m.email, r.status, await r.text().catch(() => ""));
  return r.ok;
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

/** YYYY-MM-DD as the calendar reads in `tz`. */
function localDate(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function addDays(ymd: string, n: number) {
  const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime()) / 86_400_000);
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
