"use client";
import { useCallback, useEffect, useState } from "react";
import { useStore, isOpen } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { PriorityFlag } from "@/components/ui";
import { Sparkles, RefreshCw, Check, X, CalendarDays, Clock, ChevronRight, ChevronDown } from "lucide-react";
import { Brief } from "@/components/Brief";
import { MeetingPrep } from "@/components/MeetingPrep";
import { FreeGap } from "@/components/FreeGap";
import { PageHeader, PageBody } from "@/components/PageHeader";

type Block = {
  task_id: string; title: string; priority: number; due_at: string | null;
  start_at: string; minutes: number; reason: string;
};
/** What a re-plan did to a task, relative to what was already scheduled. */
type Change = { kind: "new" } | { kind: "moved"; from: string } | { kind: "same" };
type Event = {
  id: string; title: string; start_at: string; end_at: string;
  all_day: boolean; self_response: string | null; html_link: string | null;
  task_id: string | null; attendees: { email?: string; name?: string; response?: string }[]; organizer: string | null;
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
  const [openPrep, setOpenPrep] = useState<string | null>(null);
  const [diff, setDiff] = useState<Map<string, Change>>(new Map());
  const [dropped, setDropped] = useState<string[]>([]);
  const sb = createClient();

  const loadEvents = useCallback(async () => {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start.getTime() + 86_400_000);
    const { data } = await sb.from("calendar_events")
      .select("id,title,start_at,end_at,all_day,self_response,html_link,task_id,attendees,organizer")
      .neq("status", "cancelled")
      .lt("start_at", end.toISOString()).gt("end_at", start.toISOString())
      .order("start_at");
    setEvents((data ?? []) as Event[]);
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadEvents(); setBlocks(null); setDismissed(new Set()); }, [loadEvents]);

  async function plan() {
    setLoading(true); setError(null); setDismissed(new Set());
    // Snapshot what is scheduled BEFORE re-planning, so the new proposal can say
    // what it moved instead of silently replacing the day.
    const before = new Map(scheduled.map(t => [t.id, t.scheduled_at as string]));
    const r = await fetch("/api/ai/plan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    });
    const j = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) { setError(j.error ?? `Failed (${r.status})`); return; }
    const next: Block[] = j.blocks ?? [];
    const changes = new Map<string, Change>();
    for (const b of next) {
      const was = before.get(b.task_id);
      if (!was) changes.set(b.task_id, { kind: "new" });
      else if (hhmm(was) !== hhmm(b.start_at)) changes.set(b.task_id, { kind: "moved", from: was });
      else changes.set(b.task_id, { kind: "same" });
    }
    setDiff(changes);
    setDropped(scheduled.filter(t => !next.some(b => b.task_id === t.id)).map(t => t.title));
    setBlocks(next); setNote(j.note ?? "");
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
      <PageHeader title="Plan"
        left={<>
          <input type="date" className="field h-7 w-auto text-[12px]" value={date} onChange={e => setDate(e.target.value)} />
          <button className="btn sm" onClick={() => setDate(todayISO())}>Today</button>
        </>}
        actions={
          <button className="btn primary sm" onClick={plan} disabled={loading}>
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {blocks ? "Re-plan" : "Plan my day"}
          </button>
        } />

      <PageBody className="grid gap-6">
        <Brief events={events} date={date} />
        <FreeGap events={events} isToday={date === todayISO()} />

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
            <div className="bg-panel-2 rounded-xl overflow-hidden">
              {busy.map(e => (
                <div key={e.id} className="border-b border-line-2 last:border-0">
                  <button className="w-full flex items-center gap-3 px-3 h-9 text-[13px] row-hover text-left"
                    onClick={() => setOpenPrep(openPrep === e.id ? null : e.id)}>
                    {openPrep === e.id ? <ChevronDown size={13} className="text-ink-3 shrink-0" /> : <ChevronRight size={13} className="text-ink-3 shrink-0" />}
                    <span className="tnum text-ink-2 w-[95px] shrink-0">{hhmm(e.start_at)}–{hhmm(e.end_at)}</span>
                    <span className="truncate">{e.title}</span>
                    {(e.attendees?.length ?? 0) > 0 && (
                      <span className="ml-auto text-[11px] text-ink-3 shrink-0">{e.attendees.length} invited</span>
                    )}
                  </button>
                  {openPrep === e.id && <>
                    <MeetingPrep attendees={e.attendees ?? []} organizer={e.organizer} />
                    {e.html_link && (
                      <div className="px-3 py-1.5 bg-panel-2 border-t border-line-2">
                        <a className="text-[11.5px] text-accent" href={e.html_link} target="_blank" rel="noreferrer">Open in Google Calendar</a>
                      </div>
                    )}
                  </>}
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
              <div className="bg-panel-2 rounded-xl overflow-hidden">
                {live.map(b => (
                  <div key={b.task_id} className="grid grid-cols-[95px_1fr_auto] gap-3 items-center px-3 py-2 border-b border-line-2 last:border-0">
                    <span className="tnum text-ink-2 text-[13px]">
                      {hhmm(b.start_at)}<span className="text-ink-3"> · {b.minutes}m</span>
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] truncate flex items-center gap-1.5">
                        <PriorityFlag p={b.priority} /> {b.title}
                        {diff.get(b.task_id)?.kind === "moved" && (
                          <span className="pill text-[10.5px] bg-warn/15 text-warn shrink-0">
                            moved from {hhmm((diff.get(b.task_id) as { from: string }).from)}
                          </span>
                        )}
                        {diff.get(b.task_id)?.kind === "new" && diff.size > 0 && (
                          <span className="pill text-[10.5px] bg-accent-soft text-accent shrink-0">new</span>
                        )}
                      </div>
                      <div className="text-[11.5px] text-ink-3 truncate">{b.reason}</div>
                    </div>
                    <button className="btn ghost sm text-danger" title="Not today"
                      onClick={() => setDismissed(s => new Set(s).add(b.task_id))}><X size={13} /></button>
                  </div>
                ))}
              </div>
              {dropped.length > 0 && (
                <div className="mt-2 text-[11.5px] text-ink-3">
                  No longer in the plan: <b className="text-ink-2">{dropped.join(", ")}</b> — accepting will
                  leave {dropped.length === 1 ? "it" : "them"} scheduled as before unless you unschedule {dropped.length === 1 ? "it" : "them"}.
                </div>
              )}
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
            <div className="bg-panel-2 rounded-xl overflow-hidden">
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
      </PageBody>
    </div>
  );
}
