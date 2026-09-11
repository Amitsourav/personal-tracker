"use client";
import { useStore, isOpen } from "@/lib/store";
import { isOverdue } from "@/lib/dates";
import { PriorityFlag } from "@/components/ui";
import { Zap } from "lucide-react";
import type { Task } from "@/lib/types";

type Event = { start_at: string; end_at: string; all_day: boolean; self_response: string | null; task_id: string | null };

/**
 * The gap between now and whatever is next, and what would actually fit in it.
 *
 * The daily plan covers the day as intended; this covers the day as it happens —
 * a call ends early, something is cancelled, and there is a real but awkward
 * amount of time left that usually gets spent on nothing.
 */
export function FreeGap({ events, isToday }: { events: Event[]; isToday: boolean }) {
  const { tasks, updateTask, toast } = useStore();
  if (!isToday) return null;

  const now = new Date();
  const dayEnd = new Date(now); dayEnd.setHours(21, 0, 0, 0);
  if (now >= dayEnd) return null;

  // Already inside a meeting: the gap is the wrong question.
  const busy = events.filter(e => !e.all_day && e.self_response !== "declined" && !e.task_id);
  if (busy.some(e => new Date(e.start_at) <= now && new Date(e.end_at) > now)) return null;

  const next = busy
    .map(e => new Date(e.start_at))
    .filter(d => d > now)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const until = next && next < dayEnd ? next : dayEnd;
  const gap = Math.floor((until.getTime() - now.getTime()) / 60_000);

  // Below 15 minutes there is nothing useful to start; above two hours this is
  // not a gap, it is the day, and the planner already has that covered.
  if (gap < 15 || gap > 120) return null;

  const open = tasks.filter(t =>
    t.review_state === "accepted" && isOpen(t.status) && !t.parent_id && !t.scheduled_at);
  if (!open.length) return null;

  const score = (t: Task) => {
    let s = t.priority * 10;
    if (isOverdue(t, now)) s -= 100;
    else if (t.due_at && new Date(t.due_at).getTime() - now.getTime() < 48 * 3_600_000) s -= 50;
    if ((t.ai_meta as { kind?: string })?.kind === "promise") s -= 20;
    return s;
  };

  const fits = open
    .filter(t => (t.duration_min ?? 30) <= gap)
    .sort((a, b) => score(a) - score(b))
    .slice(0, 3);
  if (!fits.length) return null;

  return (
    <section className="rounded-xl bg-panel-2 px-4 py-3 grid gap-2">
      <div className="text-[12px] font-semibold text-ink-2 flex items-center gap-1.5">
        <Zap size={13} className="text-accent" />
        {fmt(gap)} free {next && next < dayEnd ? "before your next meeting" : "until the end of the day"}
      </div>
      <div className="grid gap-1">
        {fits.map(t => (
          <div key={t.id} className="flex items-center gap-2 text-[12.5px] min-w-0">
            <PriorityFlag p={t.priority} />
            <span className="truncate">{t.title}</span>
            <span className="text-[11px] text-ink-3 shrink-0">{t.duration_min ?? 30}m</span>
            <button className="btn sm ml-auto shrink-0" onClick={async () => {
              await updateTask(t.id, { status: "in_progress", scheduled_at: new Date().toISOString() });
              toast(`Started “${t.title}”`);
            }}>Start now</button>
          </div>
        ))}
      </div>
    </section>
  );
}

const fmt = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m} minutes`;
