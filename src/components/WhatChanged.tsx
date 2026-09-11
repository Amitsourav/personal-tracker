"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { Sparkles, AlertTriangle, MessageSquare, CheckCircle2, Bell, X } from "lucide-react";

type Row = { kind: "captured" | "overdue" | "followup" | "heard" | "done"; text: string; sub?: string; href?: string; at: string };

/**
 * What moved since you last looked.
 *
 * The question a chief of staff answers and a task list cannot: not "what is on
 * the list" but "what changed while I was away". Everything here is already in
 * the database — tasks, task_events, messages all carry timestamps — so this is
 * a diff against a watermark, not new tracking.
 *
 * It stays until dismissed. Marking it seen on render would make it vanish
 * exactly when the user looked away for a second, which is how people learn to
 * distrust a summary.
 */
export function WhatChanged() {
  const { profile, updateProfile, tasks } = useStore();
  const [rows, setRows] = useState<Row[] | null>(null);
  const since = (profile?.settings as { last_seen_at?: string })?.last_seen_at ?? null;

  const load = useCallback(async () => {
    if (!profile) return;
    // First ever visit has nothing to diff against: start the clock quietly
    // rather than announcing the entire history as "new".
    if (!since) { setRows([]); return; }
    const sb = createClient();
    const now = new Date();

    const [{ data: events }, { data: msgs }] = await Promise.all([
      sb.from("task_events").select("kind,note,created_at,task_id")
        .gt("created_at", since).order("created_at", { ascending: false }).limit(60),
      sb.from("messages").select("sender_name,sender_handle,subject,sent_at,channel,person_id")
        .gt("sent_at", since).is("skipped_reason", null).eq("is_outgoing", false)
        .order("sent_at", { ascending: false }).limit(20),
    ]);

    const out: Row[] = [];

    // Captured while away — the headline, because it is work he has not seen.
    const captured = (events ?? []).filter(e => e.kind === "ai_suggested");
    if (captured.length) {
      out.push({ kind: "captured", at: captured[0].created_at, href: "/review",
        text: `${captured.length} new ${captured.length === 1 ? "task" : "tasks"} captured`,
        sub: "waiting in Review" });
    }

    // Someone chased something already on the list.
    for (const e of (events ?? []).filter(e => e.kind === "ai_follow_up").slice(0, 3)) {
      out.push({ kind: "followup", at: e.created_at, text: e.note ?? "Someone followed up", href: "/all" });
    }

    // Went overdue while he was away: a state change, not a standing fact.
    const wentOverdue = tasks.filter(t =>
      t.due_at && t.review_state === "accepted" && t.status !== "done" && t.status !== "cancelled"
      && new Date(t.due_at) > new Date(since) && new Date(t.due_at) <= now);
    for (const t of wentOverdue.slice(0, 3)) {
      out.push({ kind: "overdue", at: t.due_at!, text: t.title, sub: "went overdue", href: "/today" });
    }

    // Who got in touch.
    const senders = [...new Set((msgs ?? []).map(m => m.sender_name || m.sender_handle).filter(Boolean))];
    if (senders.length) {
      out.push({ kind: "heard", at: msgs![0].sent_at,
        text: `Heard from ${senders.slice(0, 3).join(", ")}${senders.length > 3 ? ` +${senders.length - 3}` : ""}`,
        sub: `${msgs!.length} ${msgs!.length === 1 ? "message" : "messages"}` });
    }

    // What he finished — worth seeing, and it keeps the panel honest rather than
    // a list of things going wrong.
    const completed = (events ?? []).filter(e => e.kind === "completed");
    if (completed.length) {
      out.push({ kind: "done", at: completed[0].created_at,
        text: `You finished ${completed.length}`, href: "/logbook" });
    }

    setRows(out.sort((a, b) => b.at.localeCompare(a.at)));
  }, [profile, since, tasks]);

  useEffect(() => { load(); }, [load]);

  // Start the clock on first visit so tomorrow has something to compare against.
  useEffect(() => {
    if (profile && !since) {
      updateProfile({ settings: { ...(profile.settings ?? {}), last_seen_at: new Date().toISOString() } });
    }
  }, [profile, since]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rows?.length) return null;

  const markSeen = () => updateProfile({
    settings: { ...(profile!.settings ?? {}), last_seen_at: new Date().toISOString() },
  });

  const ICON = {
    captured: Sparkles, overdue: AlertTriangle, followup: Bell,
    heard: MessageSquare, done: CheckCircle2,
  } as const;
  const TONE = {
    captured: "text-accent", overdue: "text-danger", followup: "text-warn",
    heard: "text-ink-3", done: "text-ok",
  } as const;

  return (
    <section className="rounded-xl bg-panel-2 px-4 py-3 grid gap-2.5 mb-5 fade-in">
      <div className="flex items-center gap-2">
        <h2 className="text-[12px] font-semibold text-ink-2">
          Since you last looked
          {since && <span className="text-ink-3 font-normal"> · {formatDistanceToNow(new Date(since), { addSuffix: true })}</span>}
        </h2>
        <button className="btn ghost sm ml-auto px-2 text-[11.5px]" onClick={markSeen} title="Mark as seen">
          <X size={12} /> Clear
        </button>
      </div>
      <div className="grid gap-1.5">
        {rows.map((r, i) => {
          const Icon = ICON[r.kind];
          const body = (
            <span className="flex items-start gap-2 text-[12.5px] min-w-0">
              <Icon size={13} className={`${TONE[r.kind]} mt-[3px] flex-none`} />
              <span className="min-w-0">
                <span className="text-ink">{r.text}</span>
                {r.sub && <span className="text-ink-3"> — {r.sub}</span>}
              </span>
            </span>
          );
          return r.href
            ? <Link key={i} href={r.href} className="hover:underline">{body}</Link>
            : <span key={i}>{body}</span>;
        })}
      </div>
    </section>
  );
}
