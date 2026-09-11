"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useStore, isOpen } from "@/lib/store";
import { Avatar, Modal } from "@/components/ui";
import { Empty } from "@/components/views/ListView";
import { Copy, RefreshCw, Sparkles, Check } from "lucide-react";
import type { Task } from "@/lib/types";

/**
 * Everything other people owe Amit, across all of them, oldest first.
 *
 * The People page answers "what does Rohit owe me"; this answers "what is
 * anyone sitting on, and for how long" — which is the question that actually
 * prompts a chase. Nothing in the app answered it before.
 */
export default function FollowUps() {
  const { tasks, people, updateTask, toast } = useStore();
  const [threshold, setThreshold] = useState(3);
  const [drafting, setDrafting] = useState<Task | null>(null);

  const now = new Date();
  const nowMs = now.getTime();
  const waiting = useMemo(() => tasks
    .filter(t => t.review_state === "accepted" && isOpen(t.status) && t.waiting_on_person_id && !t.parent_id)
    .map(t => ({ task: t, days: Math.floor((nowMs - new Date(t.created_at).getTime()) / 86_400_000) }))
    .sort((a, b) => b.days - a.days), [tasks, nowMs]);

  const stale = waiting.filter(w => w.days >= threshold);
  const recent = waiting.filter(w => w.days < threshold);
  const personOf = (id: string | null) => people.find(p => p.id === id);

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-2 px-4 h-12 border-b border-line">
        <h1 className="font-semibold text-[15px]">Follow-ups</h1>
        <span className="text-[11px] text-ink-3 tnum">{waiting.length}</span>
        {stale.length > 0 && <span className="text-[11px] text-p1 font-semibold tnum">{stale.length} need chasing</span>}
        <label className="ml-auto flex items-center gap-1.5 text-[11.5px] text-ink-3">
          Chase after
          <input type="number" min={0} max={90} className="field h-7 w-[56px] text-[12px] tnum" value={threshold}
            onChange={e => setThreshold(Math.max(0, Number(e.target.value) || 0))} />
          days
        </label>
      </header>

      <div className="flex-1 overflow-auto p-4 grid gap-5">
        {!waiting.length ? (
          <Empty text="Nothing you're waiting on. Tasks appear here when someone owes you something — set 'waiting on' in a task, or accept a suggestion where someone promised you something." />
        ) : <>
          <Section title="Needs chasing" hint={`waiting ${threshold}+ days`} rows={stale} personOf={personOf}
            onDraft={setDrafting} onDone={id => updateTask(id, { status: "done" })} toast={toast} accent />
          <Section title="Recent" hint="still fresh" rows={recent} personOf={personOf}
            onDraft={setDrafting} onDone={id => updateTask(id, { status: "done" })} toast={toast} />
        </>}
      </div>

      <DraftModal task={drafting} onClose={() => setDrafting(null)} />
    </div>
  );
}

function Section({ title, hint, rows, personOf, onDraft, onDone, accent }: {
  title: string; hint: string; accent?: boolean;
  rows: { task: Task; days: number }[];
  personOf: (id: string | null) => { id: string; name: string } | undefined;
  onDraft: (t: Task) => void; onDone: (id: string) => void; toast: (s: string) => void;
}) {
  if (!rows.length) return null;
  return (
    <section>
      <h2 className="text-[12px] font-semibold text-ink-2 mb-1 flex items-center gap-2">
        {title} <span className="text-ink-3 font-normal tnum">{rows.length}</span>
        <span className="text-ink-3 font-normal text-[11px]">· {hint}</span>
      </h2>
      <div className="border border-line rounded-lg bg-panel overflow-hidden">
        {rows.map(({ task, days }) => {
          const p = personOf(task.waiting_on_person_id);
          return (
            <div key={task.id} className="grid grid-cols-[1fr_auto] gap-3 items-center px-3 py-2 border-b border-line-2 last:border-0 row-hover">
              <div className="min-w-0">
                <div className="text-[13px] truncate">{task.title}</div>
                <div className="flex items-center gap-2 text-[11.5px] text-ink-3 mt-0.5">
                  {p && <Link href={`/people/${p.id}`} className="flex items-center gap-1 hover:text-ink">
                    <Avatar name={p.name} size={14} />{p.name}
                  </Link>}
                  <span className={accent ? "text-p1 font-semibold tnum" : "tnum"}>
                    {days === 0 ? "today" : `${days}d`}
                  </span>
                  {task.source_quote && <span className="truncate italic opacity-80">“{task.source_quote}”</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button className="btn sm" onClick={() => onDraft(task)} title="Draft a chaser message">
                  <Sparkles size={12} /> Chase
                </button>
                <button className="btn sm" onClick={() => onDone(task.id)} title="They delivered — close it">
                  <Check size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Generates the message, shows it for approval, and copies it. Never sends. */
function DraftModal({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { toast } = useStore();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const generate = useCallback(async (t: Task) => {
    setLoading(true); setError(null);
    const r = await fetch("/api/ai/draft", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: t.id, kind: "chaser" }),
    });
    const j = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) { setError(j.error ?? `Failed (${r.status})`); return; }
    setText(j.text); setLoadedFor(t.id);
  }, []);

  // Draft on open, once per task. Rewriting is explicit, so a failed draft does
  // not retry on every render and quietly spend the budget.
  useEffect(() => {
    if (task && loadedFor !== task.id) { setText(""); setError(null); generate(task); }
  }, [task, loadedFor, generate]);

  return (
    <Modal open={!!task} onClose={() => { setText(""); setLoadedFor(null); setError(null); onClose(); }}>
      <div className="p-4 grid gap-3">
        <div>
          <h2 className="font-semibold text-[14px]">Chaser message</h2>
          <p className="text-[11.5px] text-ink-3 mt-0.5">
            Edit anything you like, then copy it. Tracker never sends messages for you.
          </p>
        </div>
        {task && <div className="text-[12px] text-ink-2 bg-panel-2 rounded p-2 truncate">{task.title}</div>}
        {loading ? <div className="text-[12.5px] text-ink-3 flex items-center gap-2 py-6 justify-center">
          <RefreshCw size={13} className="animate-spin" /> Writing…
        </div> : error ? <div className="text-[12.5px] text-danger">{error}</div> : (
          <textarea className="bg-panel-2 rounded p-2 outline-none text-[13px] text-ink min-h-[120px] resize-y leading-relaxed"
            value={text} onChange={e => setText(e.target.value)} />
        )}
        <div className="flex gap-2">
          <button className="btn primary sm" disabled={!text} onClick={async () => {
            await navigator.clipboard.writeText(text);
            toast("Copied — paste it into WhatsApp or Gmail");
          }}><Copy size={12} /> Copy</button>
          <button className="btn sm" disabled={!task || loading} onClick={() => task && generate(task)}>
            <RefreshCw size={12} /> Rewrite
          </button>
          <button className="btn sm ml-auto" onClick={() => { setText(""); setLoadedFor(null); setError(null); onClose(); }}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
