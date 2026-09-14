import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listRepos, whoami } from "@/lib/github";

// Refreshes the list of repositories the token can see.
//
// Never flips `enabled`: connecting an account must not silently start reading
// every repository someone has ever forked. Amit picks.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { data: sec } = await supabase.from("user_secrets").select("github_token").maybeSingle();
  if (!sec?.github_token) return NextResponse.json({ error: "Add your GitHub token in Settings first" }, { status: 400 });

  try {
    const me = await whoami(sec.github_token);
    const repos = await listRepos(sec.github_token);
    await supabase.from("user_secrets").update({ github_login: me.login }).eq("user_id", user.id);

    if (repos.length) {
      const { error } = await supabase.from("github_repos").upsert(
        repos.map(r => ({
          user_id: user.id, full_name: r.full_name, default_branch: r.default_branch || "main",
          description: r.description, language: r.language, private: r.private, pushed_at: r.pushed_at,
        })),
        { onConflict: "user_id,full_name", ignoreDuplicates: false },
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ login: me.login, count: repos.length });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 400 });
  }
}
