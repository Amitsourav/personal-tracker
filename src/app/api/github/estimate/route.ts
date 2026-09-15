import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fileText, definedSymbols } from "@/lib/github";

/**
 * How long is this actually going to take?
 *
 * When eighteen items arrive in one message, they look alike. Two are twenty
 * minutes and one is two days, and nothing on the screen says which — so the
 * day planner is arithmetic over a default of thirty minutes, and a week
 * planned against it is fiction.
 *
 * Measured, then judged. The files are read here to count lines, symbols and
 * whether anything tests them; only those NUMBERS go to the model, never the
 * source. It keeps the line the rest of the GitHub features hold, and the
 * measurements are the part a model would get wrong anyway.
 *
 * The estimate is offered, not applied. Writing a guess into the planner
 * silently is how a plan stops being his.
 */
const MAX_FILES = 4;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { taskId, refresh } = await request.json().catch(() => ({}));
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

  const [{ data: hint }, { data: task }, { data: sec }, { data: spend }] = await Promise.all([
    supabase.from("task_code_hints").select("*").eq("task_id", taskId).maybeSingle(),
    supabase.from("tasks").select("title,description,source_quote,duration_min").eq("id", taskId).is("deleted_at", null).maybeSingle(),
    supabase.from("user_secrets").select("github_token, openrouter_key, model_extract, monthly_cap_usd").maybeSingle(),
    supabase.rpc("month_spend", { uid: user.id }),
  ]);

  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  if (!hint?.repo) return NextResponse.json({ error: "Find where the code is first" }, { status: 400 });
  if (hint.estimate && !refresh) return NextResponse.json({ estimate: hint.estimate, cached: true });
  if (!sec?.github_token) return NextResponse.json({ error: "No GitHub token" }, { status: 400 });
  if (!sec.openrouter_key) return NextResponse.json({ error: "Add your OpenRouter key in Settings first" }, { status: 400 });
  if (Number(spend ?? 0) >= Number(sec.monthly_cap_usd)) {
    return NextResponse.json({ error: `Monthly AI cap of $${sec.monthly_cap_usd} reached` }, { status: 400 });
  }

  const { data: repoRow } = await supabase.from("github_repos").select("paths, language").eq("full_name", hint.repo).maybeSingle();
  const allPaths = (repoRow?.paths as string[] | undefined) ?? [];

  // Measure. Everything below this point is numbers.
  const wanted = (hint.files as { path: string }[] ?? []).slice(0, MAX_FILES);
  const measured: { path: string; lines: number; symbols: number; tested: boolean }[] = [];

  for (const f of wanted) {
    const text = await fileText(sec.github_token, hint.repo, f.path);
    if (!text) continue;
    const base = f.path.split("/").pop()!.replace(/\.[^.]+$/, "");
    // A test file named after this one is the cheapest reliable signal that
    // changing it is safe — and its absence that it is not.
    const tested = allPaths.some(p =>
      /(^|\/)(tests?|__tests__|spec)\//i.test(p) || /\.(test|spec)\./i.test(p)
      ? p.toLowerCase().includes(base.toLowerCase())
      : false);
    measured.push({ path: f.path, lines: text.split("\n").length, symbols: definedSymbols(f.path, text).length, tested });
  }

  if (!measured.length) return NextResponse.json({ error: "Could not read any of those files" }, { status: 400 });

  const impact = hint.impact as { total?: number } | null;
  const diagnosis = hint.diagnosis as { fix_sketch?: string; confidence?: number } | null;

  const system = `You estimate how long a piece of software work will take one experienced developer who wrote this codebase himself. Reply ONLY with JSON matching the schema.

You are given measurements of the files involved, not their contents.

Rules:
- Give a range in minutes: low is the good case, high is what it takes if the first approach is wrong. Real work lands between them.
- Weigh: how many files must change, how long they are, how many other places call into them, whether tests exist to catch a mistake, and how clearly the task is specified.
- A task touching one short well-tested file is 15-30 minutes. One touching a 600-line file that eight other files call, with no tests, is half a day or more — most of it spent making sure nothing else broke.
- An UNCLEAR task takes longer than a clear one regardless of the code, because the first version will be wrong. Say so in the drivers if that is the case.
- "drivers" — at most three short phrases naming what actually decides the size. Concrete: "4 other files call this", "no tests on this file", "vague: no example given". Not "complexity".
- Do not pad for testing, review or deployment. He wants the time at the keyboard.
- confidence 0-1: how much the measurements actually constrain the answer.`;

  const user_msg = [
    `TASK: ${task.title}`,
    task.description ? `DETAILS: ${task.description}` : "",
    task.source_quote ? `AS REPORTED: “${task.source_quote}”` : "",
    `REPOSITORY: ${hint.repo}${repoRow?.language ? ` (${repoRow.language})` : ""}`,
    diagnosis?.fix_sketch ? `LIKELY FIX: ${diagnosis.fix_sketch}` : "",
    "",
    "FILES INVOLVED:",
    ...measured.map(m => `- ${m.path} — ${m.lines} lines, ${m.symbols} exported names, ${m.tested ? "has tests" : "no tests found"}`),
    impact?.total != null ? `\nOTHER FILES CALLING INTO THESE: ${impact.total}` : "\nOTHER FILES CALLING INTO THESE: not checked",
  ].filter(Boolean).join("\n");

  const schema = {
    type: "object", additionalProperties: false,
    properties: {
      low_minutes: { type: "integer" },
      high_minutes: { type: "integer" },
      drivers: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
    },
    required: ["low_minutes", "high_minutes", "drivers", "confidence"],
  };

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sec.openrouter_key}`, "Content-Type": "application/json",
      "HTTP-Referer": "https://personal-tracker-eta-six.vercel.app", "X-Title": "Tracker",
    },
    body: JSON.stringify({
      model: sec.model_extract, temperature: 0.1,
      messages: [{ role: "system", content: system }, { role: "user", content: user_msg }],
      response_format: { type: "json_schema", json_schema: { name: "estimate", strict: true, schema } },
      usage: { include: true },
    }),
  });
  const j = await r.json();

  const u = j.usage ?? {};
  await supabase.from("ai_usage").insert({
    user_id: user.id, purpose: "estimate", model: sec.model_extract,
    input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0, cost_usd: u.cost ?? 0,
  });
  if (!r.ok) return NextResponse.json({ error: `OpenRouter ${r.status}: ${j?.error?.message ?? "error"}` }, { status: 502 });

  let out: { low_minutes: number; high_minutes: number; drivers: string[]; confidence: number };
  try {
    out = JSON.parse((j.choices?.[0]?.message?.content ?? "{}").replace(/^```(?:json)?|```$/g, "").trim());
  } catch {
    return NextResponse.json({ error: "The model returned nothing usable" }, { status: 502 });
  }

  const low = Math.max(5, Math.round(out.low_minutes || 0));
  const high = Math.max(low, Math.round(out.high_minutes || low));
  const estimate = {
    low, high,
    // What goes in the planner if he accepts it. The midpoint leaning high,
    // because work that overruns costs a promise and work that underruns costs
    // nothing.
    suggest: Math.round(low + (high - low) * 0.6),
    drivers: (out.drivers ?? []).slice(0, 3),
    confidence: out.confidence ?? 0,
    measured,
    model: sec.model_extract,
    at: new Date().toISOString(),
  };

  const { error } = await supabase.from("task_code_hints").update({ estimate }).eq("task_id", taskId);
  if (error) console.error("estimate save failed", error);

  return NextResponse.json({ estimate, cached: false });
}
