import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fileText, definedSymbols, findReferences } from "@/lib/github";

/**
 * What else does changing this touch?
 *
 * "Where do I start" answers where the work is. This answers the question that
 * costs a weekend: the lead-search function is also called by the disbursement
 * page and the CSV export, and you will not find that out until something
 * breaks in front of a client.
 *
 * No model is involved. The names a file defines are extracted with regexes,
 * and GitHub's own code search says who calls them. Exact where a model would
 * be approximate, free, and it keeps the promise the rest of this feature makes:
 * your source code is never sent to a model provider.
 */
const MAX_FILES = 2;      // deepest-looking files only
const MAX_SYMBOLS = 4;    // GitHub code search is rate-limited hard
const MAX_REFS = 8;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { taskId, refresh } = await request.json().catch(() => ({}));
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

  const { data: hint } = await supabase.from("task_code_hints").select("*").eq("task_id", taskId).maybeSingle();
  if (!hint?.repo) return NextResponse.json({ error: "Find where the code is first" }, { status: 400 });
  if (hint.impact && !refresh) return NextResponse.json({ impact: hint.impact, cached: true });

  const { data: sec } = await supabase.from("user_secrets").select("github_token").maybeSingle();
  if (!sec?.github_token) return NextResponse.json({ error: "No GitHub token" }, { status: 400 });

  const files = (hint.files as { path: string }[] ?? []).slice(0, MAX_FILES);
  if (!files.length) return NextResponse.json({ error: "No files to analyse" }, { status: 400 });

  const groups: { file: string; symbols: string[]; refs: { path: string; symbols: string[] }[] }[] = [];
  let searched = 0;
  let searchFailed = false;

  for (const f of files) {
    const text = await fileText(sec.github_token, hint.repo, f.path);
    if (!text) continue;
    const symbols = definedSymbols(f.path, text);
    if (!symbols.length) { groups.push({ file: f.path, symbols: [], refs: [] }); continue; }

    // Longest names first: a distinctive one produces useful matches, where a
    // short one produces the whole repository.
    const pick = symbols.sort((a, b) => b.length - a.length).slice(0, MAX_SYMBOLS - searched);
    const byPath = new Map<string, Set<string>>();

    for (const sym of pick) {
      if (searched >= MAX_SYMBOLS) break;
      searched++;
      const refs = await findReferences(sec.github_token, hint.repo, sym);
      if (!refs.length) searchFailed = true;
      for (const r of refs) {
        // A file referencing its own name is not an impact.
        if (r.path === f.path) continue;
        if (!byPath.has(r.path)) byPath.set(r.path, new Set());
        byPath.get(r.path)!.add(sym);
      }
    }

    groups.push({
      file: f.path,
      symbols: pick,
      refs: [...byPath].slice(0, MAX_REFS).map(([path, s]) => ({ path, symbols: [...s] })),
    });
  }

  const total = new Set(groups.flatMap(g => g.refs.map(r => r.path))).size;
  const impact = {
    groups,
    total,
    // Code search can be unavailable or lag behind a push. Saying so beats
    // "nothing else uses this", which is the answer that gets someone hurt.
    uncertain: searchFailed && total === 0,
    at: new Date().toISOString(),
  };

  const { error } = await supabase.from("task_code_hints").update({ impact }).eq("task_id", taskId);
  if (error) console.error("impact save failed", error);

  return NextResponse.json({ impact, cached: false });
}
