import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Attempts a task and hands back the result for approval.
//
// What is actually possible here is work on text the user already has: drafting
// a reply, summarising a thread, outlining an approach. There is no web access,
// so "research" means reasoning over his own messages, not looking things up —
// and the endpoint says so rather than inventing sources.
const KINDS = ["draft", "summary", "outline"] as const;
type Kind = typeof KINDS[number];

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { taskId, kind, instruction } = await request.json().catch(() => ({}));
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  if (kind && !KINDS.includes(kind)) return NextResponse.json({ error: "unknown kind" }, { status: 400 });

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

  const { data: person } = task.person_id
    ? await supabase.from("people").select("name, company, role").eq("id", task.person_id).maybeSingle()
    : { data: null };

  // The same context the detail panel shows: the source message and its thread.
  const { data: src } = task.source_ref
    ? await supabase.from("messages").select("*").eq("external_id", task.source_ref).maybeSingle()
    : { data: null };
  const { data: thread } = src?.thread_id
    ? await supabase.from("messages").select("sender_name, is_outgoing, body, sent_at, subject")
        .eq("thread_id", src.thread_id).order("sent_at", { ascending: true }).limit(10)
    : { data: null };

  const transcript = (thread ?? []).filter(m => m.body).map(m =>
    `${m.is_outgoing ? "Me" : (m.sender_name ?? "Them")} (${new Date(m.sent_at).toLocaleDateString("en-IN")}): ${m.body?.slice(0, 1200)}`
  ).join("\n\n");

  const chosen: Kind = kind ?? (transcript && person ? "draft" : transcript ? "summary" : "outline");
  const tz = profile?.timezone ?? "Asia/Kolkata";

  const shared = `You are helping ${profile?.display_name ?? "the user"} with one task. Today is ${new Date().toLocaleDateString("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long" })}.
You have NO internet access. Work only from what is given below. Never invent a fact, a figure, a name, a date or a source. Where something is genuinely unknown, say so in one short line rather than filling the gap.
Write in plain English, Indian professional register. No preamble, no "here is", no restating the task.`;

  const asks: Record<Kind, string> = {
    draft: `Write the message ${profile?.display_name ?? "the user"} should send to complete this task${person ? `, addressed to ${person.name}` : ""}. Output only the message body: no subject line, no sign-off name. Match the tone of the conversation below. If the conversation shows something specific was asked for, address that specifically rather than generally.`,
    summary: `Summarise what this task is really about and where it stands, from the conversation below. Lead with the decision or the ask. Then list, as short bullets, anything still open or unanswered. Six lines at most.`,
    outline: `Break this task into the concrete steps needed to finish it. Between three and six steps, each one a specific action starting with a verb, in the order they should be done. No generic project-management filler.`,
  };

  const context = [
    `TASK: ${task.title}`,
    task.description ? `NOTES: ${task.description}` : "",
    task.due_at ? `DUE: ${new Date(task.due_at).toLocaleString("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "short" })}` : "",
    person ? `PERSON: ${person.name}${person.company ? ` (${person.company}${person.role ? `, ${person.role}` : ""})` : ""}` : "",
    task.source_quote ? `WHAT WAS ASKED: "${task.source_quote}"` : "",
    transcript ? `\nCONVERSATION:\n${transcript}` : "\n(No conversation is stored for this task — message bodies are deleted after 30 days.)",
    instruction ? `\nEXTRA INSTRUCTION FROM THE USER: ${instruction}` : "",
  ].filter(Boolean).join("\n");

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secrets.openrouter_key}`, "Content-Type": "application/json",
      "HTTP-Referer": "https://personal-tracker-eta-six.vercel.app", "X-Title": "Tracker",
    },
    body: JSON.stringify({
      model: secrets.model_plan, temperature: 0.4, max_tokens: 700,
      messages: [
        { role: "system", content: `${shared}\n\n${asks[chosen]}` },
        { role: "user", content: context },
      ],
      usage: { include: true },
    }),
  });
  const j = await r.json();
  if (!r.ok) return NextResponse.json({ error: `AI error: ${j?.error?.message ?? r.status}` }, { status: 502 });

  const usage = j.usage ?? {};
  const { error: usageErr } = await supabase.from("ai_usage").insert({
    user_id: user.id, purpose: `do_${chosen}`, model: secrets.model_plan,
    input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0, cost_usd: usage.cost ?? 0,
  });
  if (usageErr) console.error("ai_usage insert failed", JSON.stringify(usageErr));

  const text = (j.choices?.[0]?.message?.content ?? "").trim();
  if (!text) return NextResponse.json({ error: "AI returned nothing" }, { status: 502 });

  return NextResponse.json({ kind: chosen, text, had_context: !!transcript });
}
