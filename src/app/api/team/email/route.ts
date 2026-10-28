import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Tells a team member something happened: an invite, a task handed to them, a
// request for an update or a review, work sent back.
//
// Sent from Amit's own Gmail, so it arrives from someone they know and a reply
// lands in his inbox like any other email. Only Amit's session can call this —
// it needs his Google token, which only his rows hold — so nothing an employee
// does can send mail as him.
//
// Every email carries an X-Tracker header so the promise scanner, which reads
// his sent mail, knows these are requests he made and not promises.
const LIVE = "https://personal-tracker-eta-six.vercel.app";
const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

type Kind = "invite" | "assigned" | "status_request" | "review_request" | "returned";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { kind, memberId, taskId, note } = await request.json().catch(() => ({})) as
    { kind?: Kind; memberId?: string; taskId?: string; note?: string };
  if (!kind) return NextResponse.json({ error: "kind is required" }, { status: 400 });

  let task: { id: string; title: string; description: string | null; due_at: string | null; assignee_id: string | null } | null = null;
  if (taskId) {
    const { data } = await supabase.from("tasks").select("id, title, description, due_at, assignee_id").eq("id", taskId).maybeSingle();
    task = data;
    if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  }
  const mid = memberId ?? task?.assignee_id;
  if (!mid) return NextResponse.json({ error: "nobody to email" }, { status: 400 });

  const [{ data: member }, { data: secrets }, { data: profile }] = await Promise.all([
    supabase.from("team_members").select("id, name, email, removed_at").eq("id", mid).maybeSingle(),
    supabase.from("user_secrets").select("google_client_id, google_client_secret, google_refresh_token, google_scopes").maybeSingle(),
    supabase.from("profiles").select("display_name, timezone").maybeSingle(),
  ]);
  if (!member || member.removed_at) return NextResponse.json({ error: "team member not found" }, { status: 404 });
  if (!secrets?.google_refresh_token) {
    return NextResponse.json({ error: "Connect Google in Settings to send emails", reconnect: true }, { status: 409 });
  }
  if (!(secrets.google_scopes ?? []).includes(SEND_SCOPE)) {
    return NextResponse.json({ error: "Reconnect Google once to allow Tracker to send emails", reconnect: true }, { status: 409 });
  }

  const origin = new URL(request.url).origin;
  const app = /localhost|127\.0\.0\.1/.test(origin) ? LIVE : origin;
  const me = profile?.display_name?.trim() || "Amit";
  const first = member.name.split(" ")[0];
  const tz = profile?.timezone ?? "Asia/Kolkata";
  const due = task?.due_at ? new Date(task.due_at).toLocaleDateString("en-IN", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }) : null;
  const extra = note?.trim() ? `\n\n${note.trim()}\n` : "";
  const link = `${app}/login`;
  const signIn = `Open ${link} and sign in with ${member.email}.`;

  let subject = "", body = "";
  switch (kind) {
    case "invite":
      subject = `${me} added you to Tracker`;
      body = `Hi ${first},\n\nI'll be sharing tasks with you on Tracker. You'll see the work I assign you, can update its status, and reply to me there.\n\n${signIn} You'll get a sign-in link by email (no password).${extra}\n\n${me}`;
      break;
    case "assigned":
      subject = `New task: ${task!.title}`;
      body = `Hi ${first},\n\nI've assigned you a task:\n\n  ${task!.title}${due ? `\n  Due: ${due}` : ""}${task!.description ? `\n\n${task!.description.slice(0, 1500)}` : ""}${extra}\n\n${signIn}\n\n${me}`;
      break;
    case "status_request":
      subject = `Update please: ${task!.title}`;
      body = `Hi ${first},\n\nCan you give me an update on this?\n\n  ${task!.title}${due ? `\n  Due: ${due}` : ""}${extra}\n\nPlease reply on the task in Tracker so it stays with the task: ${link}\n\n${me}`;
      break;
    case "review_request":
      subject = `Please review: ${task!.title}`;
      body = `Hi ${first},\n\nCould you take a look at this and tell me what you think?\n\n  ${task!.title}${task!.description ? `\n\n${task!.description.slice(0, 1500)}` : ""}${extra}\n\nPlease reply on the task in Tracker: ${link}\n\n${me}`;
      break;
    case "returned":
      subject = `Sent back: ${task!.title}`;
      body = `Hi ${first},\n\nI've looked at this and it needs a bit more work:\n\n  ${task!.title}${extra}\n\nDetails are on the task in Tracker: ${link}\n\n${me}`;
      break;
    default:
      return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  }

  const token = await accessToken(secrets);
  if (!token) return NextResponse.json({ error: "Could not refresh Google access — reconnect Google in Settings", reconnect: true }, { status: 502 });

  const mime = [
    `To: ${quoteName(member.name)} <${member.email}>`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    `X-Tracker: ${kind}`,
    "",
    Buffer.from(body).toString("base64"),
  ].join("\r\n");

  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const insufficient = r.status === 403;
    return NextResponse.json({
      error: insufficient ? "Google refused to send — reconnect Google in Settings" : `Gmail send failed: ${j?.error?.message ?? r.status}`,
      reconnect: insufficient,
    }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

function quoteName(n: string) {
  return /^[\w .'-]+$/.test(n) ? `"${n}"` : `=?UTF-8?B?${Buffer.from(n).toString("base64")}?=`;
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
