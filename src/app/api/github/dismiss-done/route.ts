import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// "No, that commit was something else."
//
// Recorded rather than forgotten: a suggestion that comes back after being
// rejected is how a panel teaches people to stop reading it.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { taskId } = await request.json().catch(() => ({}));
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

  const { error } = await supabase.from("task_code_hints")
    .update({ done_dismissed_at: new Date().toISOString() })
    .eq("task_id", taskId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
