// Supabase Edge Function: sends the team emails that leads and team members
// trigger, from Amit's Gmail.
//
// Their sessions cannot send these themselves — only Amit's rows hold his
// Google token, and those must never be readable by anyone else. So the
// database functions they call (lead_assign, lead_act, lead_create_task,
// lead_invite, member_act) queue a row in team_outbox, and this function, which
// runs with the service role, sends it.
//
// Called two ways: by the app right after such an action (any signed-in user's
// JWT — all it can do is send what is already queued, so there is nothing to
// abuse), and by pg_cron every five minutes as the safety net, with the sync
// token. Each row is tried at most three times.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const APP = "https://personal-tracker-eta-six.vercel.app";

type Row = { id: string; owner_id: string; kind: string; to_member: string; task_id: string | null; actor_name: string; note: string | null; attempts: number };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = req.headers.get("Authorization")?.replace(/^Bearer /i, "").trim() ?? "";
  if (!auth) return json({ error: "unauthorized" }, 401);
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Any signed-in user, the service key, or the cron's sync token.
  let ok = auth === SERVICE_KEY;
  if (!ok) { const { data } = await db.auth.getUser(auth); ok = !!data?.user; }
  if (!ok) { const { data: uid } = await db.rpc("user_by_sync_token", { tok: auth }); ok = !!uid; }
  if (!ok) return json({ error: "unauthorized" }, 401);

  const { data: rows } = await db.from("team_outbox").select("*")
    .is("sent_at", null).lt("attempts", 3).order("created_at").limit(30);
  if (!rows?.length) return json({ sent: 0 });

  const byOwner = new Map<string, Row[]>();
  for (const r of rows as Row[]) byOwner.set(r.owner_id, [...(byOwner.get(r.owner_id) ?? []), r]);

  let sent = 0;
  for (const [owner, list] of byOwner) {
    try { sent += await sendFor(db, owner, list); }
    catch (e) { console.error("team-notify", owner, e); }
  }
  return json({ sent });
});

async function sendFor(db: SupabaseClient, owner: string, list: Row[]) {
  const [{ data: sec }, { data: profile }] = await Promise.all([
    db.from("user_secrets").select("google_client_id, google_client_secret, google_refresh_token, google_scopes").eq("user_id", owner).single(),
    db.from("profiles").select("display_name, timezone").eq("id", owner).single(),
  ]);
  const fail = (r: Row, error: string) =>
    db.from("team_outbox").update({ attempts: r.attempts + 1, error }).eq("id", r.id);

  if (!sec?.google_refresh_token || !(sec.google_scopes ?? []).includes(SEND_SCOPE)) {
    for (const r of list) await fail(r, "Gmail sending not allowed — reconnect Google");
    return 0;
  }
  const token = await accessToken(sec);
  if (!token) { for (const r of list) await fail(r, "Could not refresh Google access"); return 0; }

  const ownerName = profile?.display_name?.trim() || "Amit";
  const tz = profile?.timezone ?? "Asia/Kolkata";
  let sent = 0;
  for (const r of list) {
    const [{ data: to }, { data: task }] = await Promise.all([
      db.from("team_members").select("name, email, removed_at").eq("id", r.to_member).single(),
      r.task_id ? db.from("tasks").select("title, description, due_at").eq("id", r.task_id).single() : Promise.resolve({ data: null }),
    ]);
    if (!to || to.removed_at) { await db.from("team_outbox").update({ sent_at: new Date().toISOString(), error: "recipient removed" }).eq("id", r.id); continue; }
    const msg = compose(r, to, task, ownerName, tz);
    if (!msg) { await fail(r, "nothing to send"); continue; }
    const res = await sendMail(token, to, msg.subject, msg.body);
    if (res) { await fail(r, res); continue; }
    await db.from("team_outbox").update({ sent_at: new Date().toISOString(), error: null }).eq("id", r.id);
    sent++;
  }
  return sent;
}

function compose(r: Row, to: { name: string; email: string }, task: { title: string; description: string | null; due_at: string | null } | null, ownerName: string, tz: string) {
  const first = to.name.split(" ")[0];
  const a = r.actor_name;
  const due = task?.due_at ? new Date(task.due_at).toLocaleDateString("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }) : null;
  const note = r.note?.trim() ? `\n\n${a}: “${r.note.trim()}”` : "";
  const link = `${APP}/login`;
  const sign = `\n\n— sent by Tracker for ${a}`;
  switch (r.kind) {
    case "invite":
      return { subject: `${a} added you to ${ownerName}'s team on Tracker`, body:
        `Hi ${first},\n\n${a} has added you to ${ownerName}'s team on Tracker, where you'll see the tasks assigned to you, update them, and reply.\n\nOpen ${link} and sign in with ${to.email}. You'll get a sign-in link by email (no password).${sign}` };
    case "assigned":
      if (!task) return null;
      return { subject: `New task from ${a}: ${task.title}`, body:
        `Hi ${first},\n\n${a} has assigned you a task:\n\n  ${task.title}${due ? `\n  Due: ${due}` : ""}${task.description ? `\n\n${task.description.slice(0, 1500)}` : ""}${note}\n\nOpen it in Tracker: ${link}${sign}` };
    case "status_request":
      if (!task) return null;
      return { subject: `Update please: ${task.title}`, body:
        `Hi ${first},\n\n${a} is asking for an update on:\n\n  ${task.title}${due ? `\n  Due: ${due}` : ""}${note}\n\nPlease reply on the task in Tracker: ${link}${sign}` };
    case "returned":
      if (!task) return null;
      return { subject: `Sent back: ${task.title}`, body:
        `Hi ${first},\n\n${a} looked at this and it needs a bit more work:\n\n  ${task.title}${note}\n\nDetails are on the task in Tracker: ${link}${sign}` };
    case "submitted_to_lead":
      if (!task) return null;
      return { subject: `Ready for your review: ${task.title}`, body:
        `Hi ${first},\n\n${a} has finished this and sent it to you for review:\n\n  ${task.title}${note}\n\nApprove it (it then goes to ${ownerName}) or send it back, in Tracker: ${link}\n\n— sent by Tracker` };
  }
  return null;
}

async function sendMail(token: string, m: { name: string; email: string }, subject: string, body: string): Promise<string | null> {
  const enc = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const name = /^[\w .'-]+$/.test(m.name) ? `"${m.name}"` : `=?UTF-8?B?${enc(m.name)}?=`;
  const mime = [
    `To: ${name} <${m.email}>`,
    `Subject: =?UTF-8?B?${enc(subject)}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "X-Tracker: team",
    "",
    enc(body),
  ].join("\r\n");
  const raw = enc(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (r.ok) return null;
  return `Gmail ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`;
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
