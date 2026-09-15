import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fileText } from "@/lib/github";

/**
 * The first draft of the change.
 *
 * The last rung, and the one the industry is currently falling off. Agents
 * generating code stopped being the constraint in 2026; reviewing what they
 * produce became it. So this is built to be reviewable rather than prolific: one
 * task, the files already traced to it, a patch small enough to read.
 *
 * It writes nothing to GitHub. Amit's token is read-only and stays that way —
 * opening a pull request means handing an AI push access to his repositories,
 * which is a decision worth making deliberately after this has proved useful,
 * not as a side effect of trying it.
 *
 * It also refuses vague work. The 2026 consensus is that a task is ready for an
 * agent only when it has clear scope, named files and a way to tell whether it
 * worked; without those an agent produces confident nonsense, and confident
 * nonsense is exactly what a review bottleneck is made of. So it says what is
 * missing instead of guessing.
 */
const MAX_FILES = 2;
const MAX_CHARS = 16_000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { taskId, refresh } = await request.json().catch(() => ({}));
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

  const [{ data: hint }, { data: task }, { data: sec }, { data: spend }] = await Promise.all([
    supabase.from("task_code_hints").select("*").eq("task_id", taskId).maybeSingle(),
    supabase.from("tasks").select("title,description,source_quote").eq("id", taskId).is("deleted_at", null).maybeSingle(),
    supabase.from("user_secrets").select("github_token, openrouter_key, model_plan, monthly_cap_usd").maybeSingle(),
    supabase.rpc("month_spend", { uid: user.id }),
  ]);

  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  if (!hint?.repo) return NextResponse.json({ error: "Find where the code is first" }, { status: 400 });
  if (hint.proposal && !refresh) return NextResponse.json({ proposal: hint.proposal, cached: true });
  if (!sec?.github_token) return NextResponse.json({ error: "No GitHub token" }, { status: 400 });
  if (!sec.openrouter_key) return NextResponse.json({ error: "Add your OpenRouter key in Settings first" }, { status: 400 });
  if (Number(spend ?? 0) >= Number(sec.monthly_cap_usd)) {
    return NextResponse.json({ error: `Monthly AI cap of $${sec.monthly_cap_usd} reached` }, { status: 400 });
  }

  const wanted = (hint.files as { path: string }[] ?? []).slice(0, MAX_FILES);
  const sources: { path: string; text: string; truncated: boolean }[] = [];
  for (const f of wanted) {
    const text = await fileText(sec.github_token, hint.repo, f.path);
    if (!text) continue;
    sources.push({ path: f.path, text: text.slice(0, MAX_CHARS), truncated: text.length > MAX_CHARS });
  }
  if (!sources.length) return NextResponse.json({ error: "Could not read those files" }, { status: 400 });

  const diagnosis = hint.diagnosis as { cause?: string; fix_sketch?: string; unknowns?: string } | null;

  const system = `You are writing the first draft of a change to a codebase, for the developer who owns it to review. Reply ONLY with JSON matching the schema.

FIRST decide whether the task is specific enough to attempt. A task is ready when what "done" looks like is unambiguous from what you have been given. It is NOT ready when the desired behaviour is a matter of preference nobody has stated, when it needs a decision only the owner can make, when the change belongs mostly in files you were not given, or when it needs the database schema or an API you cannot see.
- If it is not ready, set ready=false, leave patch empty, and list in "missing" the specific things somebody would have to decide or show you. Be concrete: "which statuses count as disbursed", "the invoices table schema", not "more detail".
- Refusing is the correct answer more often than it feels. A confident wrong patch costs more to review than no patch.

If it IS ready:
- Write the smallest change that does the job. Do not reformat, rename, tidy neighbouring code, or add comments explaining what you did.
- "patch" is a unified diff with standard headers (--- a/path, +++ b/path, @@ hunks) covering ONLY the files you were given, with at least 3 lines of context each side. The paths must match exactly what you were shown.
- Match the surrounding code: its style, its error handling, its naming, its idioms. It has to look like he wrote it.
- "summary" is one or two sentences on what the change does, in plain English.
- "how_to_check" is how he confirms it works — a case to try, a test to write, a query to run. Concrete.
- "risks" names what this could break or what you were unsure about. If you had to assume something, say so here. Empty only when there is genuinely nothing.
- confidence 0-1: how sure you are this is correct AND complete.`;

  const user_msg = [
    `TASK: ${task.title}`,
    task.description ? `DETAILS: ${task.description}` : "",
    task.source_quote ? `AS ORIGINALLY ASKED: “${task.source_quote}”` : "",
    `REPOSITORY: ${hint.repo}`,
    diagnosis?.cause ? `\nDIAGNOSIS ALREADY MADE:\n${diagnosis.cause}` : "",
    diagnosis?.fix_sketch ? `INTENDED FIX: ${diagnosis.fix_sketch}` : "",
    diagnosis?.unknowns ? `KNOWN UNKNOWNS: ${diagnosis.unknowns}` : "",
    "",
    ...sources.map(s => `--- ${s.path}${s.truncated ? " (TRUNCATED — do not patch past what you can see)" : ""} ---\n${s.text}`),
  ].filter(Boolean).join("\n");

  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      ready: { type: "boolean" },
      missing: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
      patch: { type: "string" },
      how_to_check: { type: "string" },
      risks: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
    },
    required: ["ready", "missing", "summary", "patch", "how_to_check", "risks", "confidence"],
  };

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sec.openrouter_key}`, "Content-Type": "application/json",
      "HTTP-Referer": "https://personal-tracker-eta-six.vercel.app", "X-Title": "Tracker",
    },
    body: JSON.stringify({
      model: sec.model_plan, temperature: 0.1,
      messages: [{ role: "system", content: system }, { role: "user", content: user_msg }],
      response_format: { type: "json_schema", json_schema: { name: "proposal", strict: true, schema } },
      usage: { include: true },
    }),
  });
  const j = await r.json();

  const u = j.usage ?? {};
  await supabase.from("ai_usage").insert({
    user_id: user.id, purpose: "propose_change", model: sec.model_plan,
    input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0, cost_usd: u.cost ?? 0,
  });
  if (!r.ok) return NextResponse.json({ error: `OpenRouter ${r.status}: ${j?.error?.message ?? "error"}` }, { status: 502 });

  let out;
  try {
    out = JSON.parse((j.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?|```$/g, "").trim());
  } catch {
    return NextResponse.json({ error: "The model returned nothing usable" }, { status: 502 });
  }

  // A patch touching a file that was never sent is a patch written from
  // imagination. Refuse the whole thing rather than show a plausible diff
  // against a file nobody checked.
  const given = new Set(sources.map(s => s.path));
  const patch = String(out.patch ?? "");
  const touched = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1].trim());
  const strayed = touched.filter(p => !given.has(p));

  const proposal = {
    ready: !!out.ready && !strayed.length && !!patch.trim(),
    missing: strayed.length
      ? [`It tried to change ${strayed.join(", ")}, which it was not shown. Discarded.`]
      : (out.missing ?? []).slice(0, 5),
    summary: out.summary ?? "",
    patch: strayed.length ? "" : patch,
    how_to_check: out.how_to_check ?? "",
    risks: (out.risks ?? []).slice(0, 5),
    confidence: strayed.length ? 0 : (out.confidence ?? 0),
    files: sources.map(s => ({ path: s.path, truncated: s.truncated })),
    model: sec.model_plan,
    at: new Date().toISOString(),
  };

  const { error } = await supabase.from("task_code_hints").update({ proposal }).eq("task_id", taskId);
  if (error) console.error("proposal save failed", error);

  return NextResponse.json({ proposal, cached: false });
}
