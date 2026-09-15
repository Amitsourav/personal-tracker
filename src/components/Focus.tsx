"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { WhereToStart } from "./WhereToStart";
import { Timer, X, CircleCheck, Inbox } from "lucide-react";
import type { Task } from "@/lib/types";

/**
 * An hour with the door shut.
 *
 * Every other thing built here brings work in — Gmail every five minutes,
 * WhatsApp as it is typed, signals, code hints, risks. Nothing kept any of it
 * out. A developer loses more to interruption than to any single task on the
 * list: 23 minutes to recover from each one, and interrupted work carries twice
 * the errors. Capture being continuous must not mean delivery is.
 *
 * So capture keeps running and nothing is lost; it simply waits. On the way out
 * he is told what arrived, once, instead of each time.
 *
 * The timer counts up, not down. A countdown makes stopping feel like failing,
 * which is the opposite of the point — and anything that ends the session
 * abruptly at fifty minutes would itself be an interruption.
 */
export function Focus() {
  const { focus, endFocus, tasks, completeTask, toast } = useStore();
  const [now, setNow] = useState(() => Date.now());
  const [done, setDone] = useState<{ minutes: number; arrived: number; title: string } | null>(null);

  useEffect(() => {
    if (!focus) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [focus]);

  const task: Task | undefined = focus ? tasks.find(t => t.id === focus.taskId) : undefined;

  const stop = async () => {
    const title = task?.title ?? "that";
    const r = await endFocus();
    if (r) setDone({ ...r, title });
  };

  // Escape leaves the session; nothing here should trap him.
  useEffect(() => {
    if (!focus) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") stop(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  });

  if (done) {
    return (
      <div className="fixed inset-0 z-[70] bg-bg grid place-items-center px-5">
        <div className="w-full max-w-[420px] grid gap-4 fade-in">
          <div>
            <div className="text-[13px] text-ink-3">You worked for</div>
            <div className="text-[40px] font-semibold tracking-[-0.03em] tnum leading-none mt-1">
              {fmt(done.minutes)}
            </div>
            <div className="text-[13px] text-ink-2 mt-2">on “{done.title}”</div>
          </div>

          <div className="rounded-xl bg-panel-2 px-4 py-3 text-[12.5px] flex items-start gap-2">
            <Inbox size={14} className="text-ink-3 mt-0.5 flex-none" />
            <span>
              {done.arrived
                ? <>{done.arrived} {done.arrived === 1 ? "thing" : "things"} arrived while you were working. {done.arrived === 1 ? "It is" : "They are"} in Review.</>
                : <>Nothing arrived while you were working.</>}
            </span>
          </div>

          <button className="btn primary justify-center h-9" onClick={() => setDone(null)}>Back to the list</button>
        </div>
      </div>
    );
  }

  if (!focus || !task) return null;

  const mins = Math.floor((now - focus.startedAt) / 60_000);
  const secs = Math.floor((now - focus.startedAt) / 1000) % 60;
  const over = mins >= focus.plannedMin;

  return (
    <div className="fixed inset-0 z-[70] bg-bg overflow-auto">
      <div className="min-h-full grid place-items-center px-5 py-10">
        <div className="w-full max-w-[560px] grid gap-5 fade-in">

          <div className="flex items-center gap-2 text-[12px] text-ink-3">
            <Timer size={13} className={over ? "text-warn" : "text-accent"} />
            <span className="tnum">
              {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
            </span>
            <span>of {focus.plannedMin} min{over && " — over, which is fine"}</span>
            <button className="btn ghost sm ml-auto" onClick={stop}><X size={12} /> Stop</button>
          </div>

          <h1 className="text-[26px] font-semibold tracking-[-0.025em] leading-tight text-balance">
            {task.title}
          </h1>

          {task.description && (
            <p className="text-[13.5px] text-ink-2 leading-relaxed whitespace-pre-wrap">{task.description}</p>
          )}

          {task.source_quote && (
            <blockquote className="border-l-2 border-line pl-3 text-[13px] text-ink-2 italic">
              “{task.source_quote}”
            </blockquote>
          )}

          {/* The one thing from the rest of the app allowed in here, because it
              answers "where do I begin", which is the question that sends people
              back to the list — and back to the list is where focus dies. */}
          <WhereToStart task={task} />

          <div className="flex items-center gap-2 pt-1">
            <button className="btn primary justify-center h-9 flex-1" onClick={async () => {
              await completeTask(task.id);
              toast("Done", () => completeTask(task.id, false));
              stop();
            }}>
              <CircleCheck size={14} /> Finished
            </button>
            <button className="btn h-9" onClick={stop}>Not yet</button>
          </div>

          <p className="text-[11px] text-ink-3 text-center">
            Mail and messages are still being captured. You will see what arrived when you stop.
          </p>
        </div>
      </div>
    </div>
  );
}

const fmt = (m: number) => m < 60 ? `${m} minutes` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${Math.floor(m / 60)}h ${m % 60}m`;

/** Starts a session. Lives in the task detail, where the decision is made. */
export function StartFocus({ task }: { task: Task }) {
  const { startFocus } = useStore();
  const [open, setOpen] = useState(false);
  const suggested = task.duration_min ?? 50;
  const options = [...new Set([25, 50, 90, Math.max(15, Math.min(180, suggested))])].sort((a, b) => a - b);

  if (task.status === "done" || task.status === "cancelled") return null;

  return open ? (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[11.5px] text-ink-3">For how long?</span>
      {options.map(m => (
        <button key={m} className="btn sm" onClick={() => { setOpen(false); startFocus(task.id, m); }}>
          {m} min
        </button>
      ))}
      <button className="btn ghost sm px-2" onClick={() => setOpen(false)}><X size={12} /></button>
    </div>
  ) : (
    <button className="btn sm w-full justify-center" onClick={() => setOpen(true)}>
      <Timer size={13} /> Work on this now
    </button>
  );
}
