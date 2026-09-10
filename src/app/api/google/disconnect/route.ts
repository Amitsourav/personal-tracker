import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const { data: s } = await supabase.from("user_secrets").select("google_refresh_token").eq("user_id", user.id).maybeSingle();
  if (s?.google_refresh_token) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(s.google_refresh_token)}`, { method: "POST" }).catch(() => {});
  await supabase.from("user_secrets").update({ google_refresh_token: null, google_email: null, google_scopes: [], gmail_history_id: null }).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
