"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useStore, isOpen } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { isOverdue } from "@/lib/dates";
import { TriangleAlert, AlertCircle } from "lucide-react";
import type { Task } from "@/lib/types";

type Risk = { level: "high" | "medium"; what: string; why: string; href?: string };

const DAY = 86_400_000;
const days = (iso: string, now: number) => Math.floor((now - new Date(iso).getTime()) / DAY);

/**
 * What is about to go wrong.
 *
 * Computed locally, not by a model: these are arithmetic over data already held,
 * they need to be exact, and a risk panel that costs money per glance is one
 * that gets switched off.
 *
 * It renders nothing when nothing is wrong. A permanent warning strip is a
 * warning strip nobody reads.
 */
export function Risks() {
  const { tasks, people } = useStore();
  const [capture, setCapture] = useState<Risk | null>(null);

  // Capture health. Three separate failures today looked healthy from the
  // outside - a broken trigger, a cron rejected every run, unlogged spend - so
  // "is the machinery actually running" earns a place beside the work risks.
  useEffect(() => {
    createClient()
      .from("sync_runs")
      .select("started_at,error,created_tasks")
      .order("started_at", { ascending: false }).limit(12)
      .then(({ data }) => {
        const runs = data ?? [];
        if (!runs.length) return setCapture(null);
        const last = new Date(runs[0].started_at).getTime();
        const hours = Math.floor((Date.now() - last) / 3_600_000);
        if (hours >= 3) {
          setCapture({ level: "high", what: "Capture has stopped",
            why: `Nothing has been checked for ${hours} hours. Gmail and WhatsApp tasks are not arriving.`,
            href: "/settings" });
          return;
        }
        const failed = runs.filter(r => r.error).length;
        if (failed >= 3) {
          setCapture({ level: "medium", what: "Capture is erroring",
            why: `${failed} of the last ${runs.length} checks failed. Some messages may not have been read.`,
            href: "/settings" });
          return;
        }
        setCapture(null);
      });
  }, []);

  const now = new Date().getTime();
  const open = tasks.filter(t => t.review_state === "accepted" && isOpen(t.status) && !t.parent_id);
  const risks: Risk[] = [];

  // Overdue and unplanned: overdue alone is a fact, overdue with no time set
  // aside for it is a risk, because nothing currently changes it.
  const overdueUnplanned = open.filter(t => isOverdue(t, new Date(now)) && !t.scheduled_at);
  if (overdueUnplanned.length) {
    risks.push({ level: "high", href: "/today",
      what: `${overdueUnplanned.length} overdue with no time set aside`,
      why: `Oldest: “${overdueUnplanned.sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""))[0].title}”. Nothing currently moves these.` });
  }

  // A promise he made, going quiet. Worse than a late task: someone is waiting
  // and does not know it has stalled.
  const staleP = open.filter(t =>
    (t.ai_meta as { kind?: string })?.kind === "promise" && days(t.created_at, now) >= 5 && !t.scheduled_at);
  if (staleP.length) {
    risks.push({ level: "high", href: "/followups",
      what: `${staleP.length} ${staleP.length === 1 ? "promise is" : "promises are"} going stale`,
      why: `You committed to ${staleP.length === 1 ? "this" : "these"} ${days(staleP[0].created_at, now)}+ days ago and nothing has moved. Whoever you told has not been updated.` });
  }

  // Delivered, unacknowledged, and long enough that silence is information.
  const unconfirmed = tasks.filter(t =>
    t.verification === "self" && t.status === "done" && !t.deleted_at
    && t.completed_at && days(t.completed_at, now) >= 3);
  if (unconfirmed.length) {
    risks.push({ level: "medium", href: "/followups",
      what: `${unconfirmed.length} finished but never confirmed`,
      why: `Marked done ${days(unconfirmed[0].completed_at!, now)}+ days ago with no acknowledgement. It may not have landed.` });
  }

  // Someone has been waiting long enough that it is now your problem.
  const waited = open.filter(t => t.waiting_on_person_id && days(t.created_at, now) >= 7);
  if (waited.length) {
    const who = people.find(p => p.id === waited[0].waiting_on_person_id)?.name ?? "someone";
    risks.push({ level: "medium", href: "/followups",
      what: `Waiting ${days(waited[0].created_at, now)} days on ${who}`,
      why: waited.length > 1 ? `And ${waited.length - 1} other${waited.length > 2 ? "s" : ""}. Nobody has been chased.`
        : "Nobody has been chased about it." });
  }

  // A day that cannot hold what is pointed at it.
  const byDay = new Map<string, Task[]>();
  for (const t of open) {
    const d = t.due_at ?? t.start_at;
    if (!d) continue;
    const when = new Date(d);
    if (when.getTime() < now || when.getTime() > now + 7 * DAY) continue;
    const key = when.toDateString();
    byDay.set(key, [...(byDay.get(key) ?? []), t]);
  }
  const heavy = [...byDay.entries()]
    .map(([day, ts]) => ({ day, ts, mins: ts.reduce((s, t) => s + (t.duration_min ?? 30), 0) }))
    .filter(x => x.mins > 6 * 60).sort((a, b) => b.mins - a.mins)[0];
  if (heavy) {
    risks.push({ level: "medium", href: "/plan",
      what: `${new Date(heavy.day).toLocaleDateString("en-IN", { weekday: "long" })} is overloaded`,
      why: `${heavy.ts.length} items pointed at one day, roughly ${Math.round(heavy.mins / 60)} hours of work.` });
  }

  // Suggestions decay: a review queue nobody empties stops being read at all.
  const backlog = tasks.filter(t => t.review_state === "suggested" && !t.deleted_at);
  if (backlog.length >= 10) {
    risks.push({ level: "medium", href: "/review",
      what: `${backlog.length} suggestions unreviewed`,
      why: "Captured work you have not looked at. The oldest may already be out of date." });
  }

  const all = [...(capture ? [capture] : []), ...risks]
    .sort((a, b) => (a.level === "high" ? 0 : 1) - (b.level === "high" ? 0 : 1));
  if (!all.length) return null;

  return (
    <section className="grid gap-1.5 mb-5">
      {all.slice(0, 4).map((r, i) => {
        const Icon = r.level === "high" ? TriangleAlert : AlertCircle;
        const tone = r.level === "high" ? "text-danger" : "text-warn";
        const body = (
          <div className="flex items-start gap-2.5 rounded-xl bg-panel-2 px-4 py-3">
            <Icon size={15} className={`${tone} mt-0.5 flex-none`} />
            <div className="text-[12.5px] min-w-0">
              <span className="font-semibold text-ink">{r.what}</span>
              <span className="text-ink-2"> — {r.why}</span>
            </div>
          </div>
        );
        return r.href
          ? <Link key={i} href={r.href} className="block hover:opacity-90 transition-opacity">{body}</Link>
          : <div key={i}>{body}</div>;
      })}
    </section>
  );
}
