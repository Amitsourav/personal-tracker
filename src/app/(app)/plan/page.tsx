"use client";
import { useCallback, useEffect, useState } from "react";
import { useStore, isOpen } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { PriorityFlag } from "@/components/ui";
import { Sparkles, RefreshCw, Check, X, CalendarDays, Clock } from "lucide-react";
import { Brief } from "@/components/Brief";

type Block = {
  task_id: string; title: string; priority: number; due_at: string | null;
  start_at: string; minutes: number; reason: string;
};
type Event = {
  id: string; title: string; start_at: string; end_at: string;
  all_day: boolean; self_response: string | null; html_link: string | null;
  task_id: string | null;
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * The day: meetings you already have, and a plan for the gaps between them.
 *
 * The plan is a proposal. Nothing is scheduled until it is accepted — a planner
 * that rearranged the day by itself would be worse than no planner.
 */
export default function Plan() {
  const { tasks, updateTask, toast } = useStore();
  const [date, setDate] = useState(todayISO());
  const [events, setEvents] = useState<Event[]>([]);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const sb = createClient();

  const loadEvents = useCallback(async () => {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start.getTime() + 86_400_000);
    const { data } = await sb.from("calendar_events")
      .select("id,title,start_at,end_at,all_day,self_response,html_link,task_id")
      .neq("status", "cancelled")
      .lt("start_at", end.toISOString()).gt("end_at", start.toISOString())
      .order("start_at");
    setEvents((data ?? []) as Event[]);
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadEvents(); setBlocks(null); setDismissed(new Set()); }, [loadEvents]);

  async function plan() {
    setLoading(true); setError(null); setDismissed(new Set());
    const r = await fetch("/api/ai/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    });
    const j = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) { setError(j.error ?? `Failed (${r.status})`); return; }
    setBlocks(j.blocks ?? []); setNote(j.note ?? "");
  }

  const live = (blocks ?? []).filter(b => !dismissed.has(b.task_id));

  /** Mirror one task's block into Google. Never throws: a calendar hiccup must
   *  not undo a plan Amit has already accepted in Tracker. */
  const mirror = async (taskId: string) => {
    try {
      const r = await fetch("/api/calendar/block", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      if (!r.ok) return false;
    } catch { return false; }
    return true;
  };

  async function acceptAll() {
    setSyncing(true);
    for (const b of live) await updateTask(b.task_id, { scheduled_at: b.start_at, duration_min: b.minutes });
    const results = await Promise.all(live.map(b => mirror(b.task_id)));
    setSyncing(false);
    const failed = results.filter(x => !x).length;
    toast(failed
      ? `Scheduled ${live.length}, but ${failed} did not reach Google Calendar`
      : `Scheduled ${live.length} and added to Google Calendar`);
    setBlocks(null);
    loadEvents();
  }

  async function unschedule(taskId: string) {
    await updateTask(taskId, { scheduled_at: null, duration_min: null });
    await mirror(taskId);   // scheduled_at is null now, so this removes the event
    loadEvents();
  }

  const scheduled = tasks.filter(t => {
    if (!t.scheduled_at || t.review_state !== "accepted" || !isOpen(t.status)) return false;
    const d = new Date(t.scheduled_at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` === date;
  }).sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));

  // Our own time-blocks come back on the next calendar sync; they belong in
  // "Time-blocked", not in "Meetings", or the day looks twice as full as it is.
  const busy = events.filter(e => !e.all_day && e.self_response !== "declined" && !e.task_id);
  const allDay = events.filter(e => e.all_day);

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-2 px-4 h-12 border-b border-line">
        <h1 className="font-semibold text-[15px]">Plan</h1>
        <input type="date" className="field h-7 w-auto text-[12px]" value={date} onChange={e => setDate(e.target.value)} />
        <button className="btn sm" onClick={() => setDate(todayISO())}>Today</button>
        <button className="btn primary sm ml-auto" onClick={plan} disabled={loading}>
          {loading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {blocks ? "Re-plan" : "Plan my day"}
        </button>
      </header>

      <div className="flex-1 overflow-auto p-4 grid gap-5 max-w-[820px]">
        <Brief events={events} date={date} />

        {allDay.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {allDay.map(e => <span key={e.id} className="pill bg-accent-soft text-accent">{e.title}</span>)}
          </div>
        )}

        <section>
          <h2 className="text-[12px] font-semibold text-ink-2 mb-1 flex items-center gap-1.5">
            <CalendarDays size={13} /> Meetings <span className="text-ink-3 font-normal tnum">{busy.length}</span>
          </h2>
          {busy.length ? (
            <div className="border border-line rounded-lg bg-panel overflow-hidden">
              {busy.map(e => (
                <div key={e.id} className="flex items-center gap-3 px-3 h-9 border-b border-line-2 last:border-0 text-[13px]">
                  <span className="tnum text-ink-2 w-[95px] shrink-0">{hhmm(e.start_at)}–{hhmm(e.end_at)}</span>
                  <span className="truncate">{e.title}</span>
                  {e.html_link && <a className="ml-auto text-[11px] text-accent" href={e.html_link} target="_blank" rel="noreferrer">open</a>}
                </div>
              ))}
            </div>
          ) : <div className="text-ink-3 text-[12.5px]">No meetings. The whole day is yours.</div>}
        </section>

        {blocks !== null && (
          <section>
            <h2 className="text-[12px] font-semibold text-ink-2 mb-1 flex items-center gap-1.5">
              <Sparkles size={13} className="text-accent" /> Proposed plan
              <span className="text-ink-3 font-normal tnum">{live.length}</span>
              <span className="text-ink-3 font-normal text-[11px]">· nothing is scheduled until you accept</span>
            </h2>
            {note && <p className="text-[12px] text-ink-3 mb-2">{note}</p>}
            {!live.length ? (
              <div className="text-ink-3 text-[12.5px]">Nothing proposed.</div>
            ) : <>
              <div className="border border-line rounded-lg bg-panel overflow-hidden">
                {live.map(b => (
                  <div key={b.task_id} className="grid grid-cols-[95px_1fr_auto] gap-3 items-center px-3 py-2 border-b border-line-2 last:border-0">
                    <span className="tnum text-ink-2 text-[13px]">
                      {hhmm(b.start_at)}<span className="text-ink-3"> · {b.minutes}m</span>
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] truncate flex items-center gap-1.5"><PriorityFlag p={b.priority} /> {b.title}</div>
                      <div className="text-[11.5px] text-ink-3 truncate">{b.reason}</div>
                    </div>
                    <button className="btn ghost sm text-danger" title="Not today"
                      onClick={() => setDismissed(s => new Set(s).add(b.task_id))}><X size={13} /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <button className="btn primary sm" onClick={acceptAll} disabled={syncing}>
                  {syncing ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                  Accept plan &amp; add to Calendar
                </button>
                <button className="btn sm" onClick={() => setBlocks(null)}>Discard</button>
              </div>
            </>}
          </section>
        )}

        {error && <div className="text-[12.5px] text-danger">{error}</div>}

        <section>
          <h2 className="text-[12px] font-semibold text-ink-2 mb-1 flex items-center gap-1.5">
            <Clock size={13} /> Time-blocked <span className="text-ink-3 font-normal tnum">{scheduled.length}</span>
          </h2>
          {scheduled.length ? (
            <div className="border border-line rounded-lg bg-panel overflow-hidden">
              {scheduled.map(t => (
                <div key={t.id} className="grid grid-cols-[95px_1fr_auto] gap-3 items-center px-3 py-2 border-b border-line-2 last:border-0 row-hover">
                  <span className="tnum text-ink-2 text-[13px]">
                    {hhmm(t.scheduled_at!)}{t.duration_min ? <span className="text-ink-3"> · {t.duration_min}m</span> : null}
                  </span>
                  <span className="text-[13px] truncate flex items-center gap-1.5"><PriorityFlag p={t.priority} /> {t.title}</span>
                  <button className="btn ghost sm" title="Unschedule and remove from Google Calendar"
                    onClick={() => unschedule(t.id)}><X size={13} /></button>
                </div>
              ))}
            </div>
          ) : <div className="text-ink-3 text-[12.5px]">Nothing time-blocked yet. Press <b>Plan my day</b>.</div>}
        </section>
      </div>
    </div>
  );
}
