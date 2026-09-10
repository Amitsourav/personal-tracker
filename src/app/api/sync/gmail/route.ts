import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL } from "@/lib/supabase/env";

// Manual "Sync now": forwards the user's session token to the ingestion function, which runs for that user only.
export async function POST() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ ok: false, error: "not signed in" }, { status: 401 });
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ingest-gmail`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: "{}" });
  const body = await r.text();
  return new NextResponse(body, { status: r.status, headers: { "Content-Type": "application/json" } });
}
