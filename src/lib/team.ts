"use client";
import { useEffect, useState } from "react";
import { createClient } from "./supabase/client";
import { useStore } from "./store";

export type TeamEmailKind = "invite" | "assigned" | "status_request" | "review_request" | "returned";

/**
 * Emails a team member, and says plainly when it could not. A request that was
 * recorded in Tracker but never reached their inbox has to look different from
 * one that did, or Amit waits on someone who was never asked.
 */
export async function teamEmail(kind: TeamEmailKind, ids: { taskId?: string; memberId?: string; note?: string }) {
  const r = await fetch("/api/team/email", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, ...ids }),
  });
  const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; reconnect?: boolean };
  const toast = useStore.getState().toast;
  if (!r.ok || !j.ok) toast(`Saved in Tracker, but no email went out: ${j.error ?? r.status}`);
  return { ok: !!j.ok, reconnect: !!j.reconnect };
}

/**
 * Sends whatever a lead or team member just queued (assignments, update
 * requests, reviews). Their session cannot reach Amit's Gmail; the
 * team-notify function can. If this call is lost, the five-minute cron sends
 * it anyway — hence fire and forget.
 */
export function pokeOutbox() {
  createClient().functions.invoke("team-notify", { body: {} }).catch(() => {});
}

/** Whatever team members said that Amit has not opened yet. */
export function useTeamUnseen() {
  const userId = useStore(s => s.userId);
  const [rows, setRows] = useState<{ task_id: string }[]>([]);
  useEffect(() => {
    if (!userId) return;
    const sb = createClient();
    const load = () => sb.from("task_comments").select("task_id")
      .eq("owner_id", userId).neq("author_id", userId).is("seen_at", null)
      .then(({ data }) => setRows(data ?? []));
    load();
    const ch = sb.channel(`team-unseen-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments" }, load)
      .subscribe();
    window.addEventListener("team-seen", load);
    return () => { sb.removeChannel(ch); window.removeEventListener("team-seen", load); };
  }, [userId]);
  return rows;
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("");
