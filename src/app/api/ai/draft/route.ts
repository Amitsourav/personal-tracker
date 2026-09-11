import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Drafts a short message for a task: a chaser for something someone owes Amit,
// or an acknowledgement for something he has just accepted.
//
// The draft is returned as text and never sent. Amit copies it and sends it
// himself — sending on his behalf would need the gmail.compose scope and a
// re-consent, and "AI suggests, Amit approves" applies to outgoing words too.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { taskId, kind } = await request.json().catch(() => ({}));
  if (!taskId || (kind !== "chaser" && kind !== "ack")) {
    return NextResponse.json({ error: "taskId and kind ('chaser' | 'ack') are required" }, { status: 400 });
  }

  // RLS scopes all of these to the signed-in user.
  const [{ data: task }, { data: secrets }, { data: profile }, { data: spend }] = await Promise.all([
    supabase.from("tasks").select("*").eq("id", taskId).is("deleted_at", null).maybeSingle(),
    supabase.from("user_secrets").select("openrouter_key, model_plan, monthly_cap_usd").maybeSingle(),
    supabase.from("profiles").select("display_name, timezone, eod_time").maybeSingle(),
    supabase.rpc("month_spend", { uid: user.id }),
  ]);

  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  if (!secrets?.openrouter_key) return NextResponse.json({ error: "Add your OpenRouter key in Settings first" }, { status: 400 });
  if (Number(spend ?? 0) >= Number(secrets.monthly_cap_usd)) {
    return NextResponse.json({ error: `Monthly AI cap of $${secrets.monthly_cap_usd} reached` }, { status: 400 });
  }

  const personId = kind === "chaser" ? task.waiting_on_person_id : task.person_id;
  const { data: person } = personId
    ? await supabase.from("people").select("name, emails, phones, company, role").eq("id", personId).maybeSingle()
    : { data: null };

  // WhatsApp gets a shorter, less formal message than email. Guessing wrong here
  // is the difference between a natural nudge and something nobody would send.
  const channel = task.source_kind === "whatsapp" || (!person?.emails?.length && person?.phones?.length)
    ? "whatsapp" : "email";

  const tz = profile?.timezone ?? "Asia/Kolkata";
  const days = Math.floor((Date.now() - new Date(task.created_at).getTime()) / 86_400_000);
  const due = task.due_at
    ? new Date(task.due_at).toLocaleString("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "short" })
    : null;

  const system = `You draft one short message for ${profile?.display_name ?? "the user"} to send. Output ONLY the message body — no subject line, no greeting block, no sign-off name, no quotes around it, no explanation.
Style:
- ${channel === "whatsapp" ? "WhatsApp: 1-2 short lines, warm and informal. No salutation." : "Email: 2-4 short lines, plainly polite. Begin with a 'Hi <first name>,' line and stop before any sign-off."}
- Indian professional register. Plain English. Hinglish only if it would sound natural to a close colleague; never in a first chase or with someone senior.
- Never apologise for chasing, never grovel, never threaten. Do not invent facts, dates or excuses that are not given below.
- Reference the specific thing by name so it is obvious what is meant.`;

  const prompt = kind === "chaser"
    ? `Chase ${person?.name ?? "them"} about something they owe me. Be gentle: this is a nudge, not a complaint.
Thing I am waiting on: ${task.title}
${task.description ? `Detail: ${task.description}\n` : ""}${task.source_quote ? `What they originally said: "${task.source_quote}"\n` : ""}${due ? `They said: ${due}\n` : ""}Waiting: ${days} day(s)
${person?.company ? `They work at: ${person.company}\n` : ""}Ask where it stands and offer to help if something is blocking it.`
    : `Acknowledge a task ${person?.name ?? "they"} just asked me to do, confirming I will do it.
Task: ${task.title}
${task.source_quote ? `What they asked: "${task.source_quote}"\n` : ""}${due ? `I am committing to: ${due}` : "No deadline was given — say I will get to it shortly, do not invent a date."}
Keep it brief: confirm, state the timing, nothing else.`;

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secrets.openrouter_key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://personal-tracker-eta-six.vercel.app",
      "X-Title": "Tracker",
    },
    body: JSON.stringify({
      model: secrets.model_plan,
      temperature: 0.5,
      max_tokens: 300,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      usage: { include: true },
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    return NextResponse.json({ error: `AI error: ${j?.error?.message ?? r.status}` }, { status: 502 });
  }

  const usage = j.usage ?? {};
  const { error: usageErr } = await supabase.from("ai_usage").insert({
    user_id: user.id, purpose: `draft_${kind}`, model: secrets.model_plan,
    input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0,
    cost_usd: usage.cost ?? 0,
  });
  // Never swallow this: unlogged spend makes monthly_cap_usd meaningless, and a
  // silently dropped insert is exactly how that went unnoticed the first time.
  if (usageErr) console.error("ai_usage insert failed", JSON.stringify(usageErr));

  const text = (j.choices?.[0]?.message?.content ?? "").trim().replace(/^["“]|["”]$/g, "");
  if (!text) return NextResponse.json({ error: "AI returned an empty draft" }, { status: 502 });

  return NextResponse.json({ text, channel, person: person?.name ?? null });
}
