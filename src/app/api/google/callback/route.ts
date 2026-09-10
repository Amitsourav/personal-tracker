import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const err = searchParams.get("error");
  const back = (e: string) => NextResponse.redirect(`${origin}/settings?error=${e}`);
  if (err) return back(err);
  const jar = await cookies();
  if (!code || !state || jar.get("g_state")?.value !== state) return back("state");
  jar.delete("g_state");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);
  const { data: s } = await supabase.from("user_secrets").select("google_client_id, google_client_secret").eq("user_id", user.id).maybeSingle();
  if (!s?.google_client_id || !s.google_client_secret) return back("no_client");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: s.google_client_id, client_secret: s.google_client_secret, redirect_uri: `${origin}/api/google/callback`, grant_type: "authorization_code" }),
  });
  const tok = await tokenRes.json() as { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!tok.access_token) return back("token_" + (tok.error ?? "unknown"));
  if (!tok.refresh_token) return back("no_refresh");

  const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } }).then(r => r.json()) as { email?: string };
  await supabase.from("user_secrets").update({
    google_refresh_token: tok.refresh_token, google_email: info.email ?? null, google_scopes: (tok.scope ?? "").split(" ").filter(Boolean),
    gmail_history_id: null, gmail_last_sync_at: null,
  }).eq("user_id", user.id);
  return NextResponse.redirect(`${origin}/settings?connected=google`);
}
