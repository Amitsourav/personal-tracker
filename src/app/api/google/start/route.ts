import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

const SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar",
];

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: s } = await supabase.from("user_secrets").select("google_client_id").eq("user_id", user.id).maybeSingle();
  if (!s?.google_client_id) return NextResponse.redirect(new URL("/settings?error=no_client", request.url));
  const state = crypto.randomUUID();
  (await cookies()).set("g_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  const origin = new URL(request.url).origin;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", s.google_client_id);
  url.searchParams.set("redirect_uri", `${origin}/api/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
