"use client";
import Link from "next/link";
import { useStore, isOpen } from "@/lib/store";
import { isOverdue } from "@/lib/dates";
import { AlertTriangle, CalendarDays, Clock, Handshake, TriangleAlert } from "lucide-react";
import type { Task } from "@/lib/types";

type Event = { id: string; title: string; start_at: string; end_at: string; all_day: boolean; self_response: string | null; task_id: string | null };

/**
 * The morning brief, and the deadline warning that goes with it.
 *
 * Computed locally rather than by a model: these numbers must be exact and
 * instant, they are read every morning, and there is nothing here a model would
 * get more right than arithmetic would. It also means the brief costs nothing.
 */
export function Brief({ events, date }: { events: Event[]; date: string }) {
  const { tasks, people } = useStore();
  const now = new Date();
  const isToday = date === localISO(now);

  const open = tasks.filter(t => t.review_state === "accepted" && isOpen(t.status) && !t.parent_id);
  const overdue = open.filter(t => isOverdue(t, now));
  const dueToday = open.filter(t => t.due_at && !isOverdue(t, now) && sameLocalDay(t.due_at, date));
  const promises = open.filter(t => (t.ai_meta as { kind?: string })?.kind === "promise");
  const waiting = open.filter(t => t.waiting_on_person_id
    && now.getTime() - new Date(t.created_at).getTime() >= 3 * 86_400_000);

  const meetings = events.filter(e => !e.all_day && e.self_response !== "declined" && !e.task_id);
  const next = isToday ? meetings.find(e => new Date(e.start_at) > now) : meetings[0];

  // Deadline risk: work that must happen in the next 48 hours against the time
  // actually left in the working day after meetings.
  const soon = open.filter(t => {
    if (!t.due_at) return false;
    const h = (new Date(t.due_at).getTime() - now.getTime()) / 3_600_000;
    return h >= 0 && h <= 48;
  });
  const needMin = [...overdue, ...soon].reduce((sum, t) => sum + (t.duration_min ?? 30), 0);
  const freeMin = isToday ? freeMinutesLeft(meetings, now) : null;
  const atRisk = freeMin !== null && needMin > freeMin && needMin > 0;

  const nothing = !overdue.length && !dueToday.length && !promises.length && !waiting.length && !meetings.length;
  if (nothing) return null;

  return (
    <section className="grid gap-2">
      {atRisk && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
          <TriangleAlert size={15} className="text-danger mt-0.5 flex-none" />
          <div className="text-[12.5px]">
            <b className="text-ink">Deadline risk.</b>{" "}
            <span className="text-ink-2">
              {overdue.length + soon.length} {overdue.length + soon.length === 1 ? "task is" : "tasks are"} due
              within 48 hours, needing about <b className="text-ink">{fmtMin(needMin)}</b>, but only{" "}
              <b className="text-ink">{fmtMin(freeMin!)}</b> of your working day is left after meetings.
              Something needs moving, delegating or dropping.
            </span>
          </div>
        </div>
      )}

      <div className="grid gap-1.5 rounded-lg border border-line bg-panel px-3 py-2.5">
        <div className="text-[12px] font-semibold text-ink-2">
          {isToday ? greeting(now) : "That day"}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
          <Stat icon={CalendarDays} label="meetings" n={meetings.length}
            extra={next ? `next ${hhmm(next.start_at)} · ${next.title}` : undefined} />
          <Stat icon={AlertTriangle} label="overdue" n={overdue.length} href="/today" danger />
          <Stat icon={Clock} label="due today" n={dueToday.length} href="/today" />
          <Stat icon={Handshake} label="you promised" n={promises.length} href="/review" />
          <Stat icon={Clock} label="waiting on others" n={waiting.length} href="/followups" />
        </div>
        {overdue.length > 0 && (
          <div className="text-[11.5px] text-ink-3 truncate">
            Oldest overdue: <b className="text-ink-2">{oldest(overdue)!.title}</b>
            {waiting.length > 0 && <> · longest wait: <b className="text-ink-2">{personName(people, waiting)}</b></>}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ icon: Icon, label, n, href, danger, extra }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string; n: number; href?: string; danger?: boolean; extra?: string;
}) {
  if (!n && !extra) return null;
  const body = (
    <span className={`flex items-center gap-1.5 ${danger && n ? "text-danger" : "text-ink-2"}`}>
      <Icon size={13} className="opacity-70" />
      <b className={`tnum ${danger && n ? "text-danger" : "text-ink"}`}>{n}</b> {label}
      {extra && <span className="text-ink-3 truncate max-w-[240px]">· {extra}</span>}
    </span>
  );
  return href && n ? <Link href={href} className="hover:underline">{body}</Link> : body;
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
const localISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const sameLocalDay = (iso: string, date: string) => localISO(new Date(iso)) === date;
const fmtMin = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
const oldest = (ts: Task[]) => ts.slice().sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""))[0];

function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? "This morning" : h < 17 ? "This afternoon" : "This evening";
}

function personName(people: { id: string; name: string }[], waiting: Task[]) {
  const t = waiting.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  return people.find(p => p.id === t?.waiting_on_person_id)?.name ?? "someone";
}

/** Working minutes left today after meetings, using a 09:00-21:00 default day. */
function freeMinutesLeft(meetings: Event[], now: Date) {
  const end = new Date(now); end.setHours(21, 0, 0, 0);
  if (now >= end) return 0;
  let free = Math.round((end.getTime() - now.getTime()) / 60_000);
  for (const m of meetings) {
    const s = new Date(m.start_at), e = new Date(m.end_at);
    const from = Math.max(s.getTime(), now.getTime());
    const to = Math.min(e.getTime(), end.getTime());
    if (to > from) free -= Math.round((to - from) / 60_000);
  }
  return Math.max(0, free);
}
