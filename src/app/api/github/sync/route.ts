import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { repoTree, readme } from "@/lib/github";

// Reads one repository's file list and README so tasks can be pointed at it.
//
// Failures are stored on the row rather than thrown away: a repo that cannot be
// read should say so in Settings, not look the same as one nobody has indexed.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { fullName } = await request.json().catch(() => ({}));
  if (!fullName) return NextResponse.json({ error: "fullName is required" }, { status: 400 });

  const [{ data: sec }, { data: repo }] = await Promise.all([
    supabase.from("user_secrets").select("github_token").maybeSingle(),
    supabase.from("github_repos").select("*").eq("full_name", fullName).maybeSingle(),
  ]);
  if (!sec?.github_token) return NextResponse.json({ error: "No GitHub token" }, { status: 400 });
  if (!repo) return NextResponse.json({ error: "repo not found" }, { status: 404 });

  try {
    const { paths, truncated } = await repoTree(sec.github_token, fullName, repo.default_branch);
    const rm = await readme(sec.github_token, fullName);
    await supabase.from("github_repos").update({
      paths, path_count: paths.length, readme: rm,
      indexed_at: new Date().toISOString(),
      index_error: truncated ? "Very large repo — only the first 3000 files were read" : null,
    }).eq("id", repo.id);
    return NextResponse.json({ files: paths.length, truncated });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    await supabase.from("github_repos").update({ index_error: msg.slice(0, 300), indexed_at: new Date().toISOString() }).eq("id", repo.id);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
