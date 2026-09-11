"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore, isOpen } from "@/lib/store";
import { Avatar } from "@/components/ui";
import { Empty } from "@/components/views/ListView";
import { Sparkles, Check } from "lucide-react";
import { DraftModal } from "@/components/DraftModal";
import { PageHeader, PageBody } from "@/components/PageHeader";
import { NeedsConfirming } from "@/components/NeedsConfirming";
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
      <PageHeader title="Follow-ups" count={waiting.length}
        hint={stale.length ? `${stale.length} need chasing` : undefined}
        actions={
          <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
            Chase after
            <input type="number" min={0} max={90} className="field h-7 w-[58px] text-[12px] tnum" value={threshold}
              onChange={e => setThreshold(Math.max(0, Number(e.target.value) || 0))} />
            days
          </label>
        } />

      <PageBody className="grid gap-6">
        <NeedsConfirming />
        {!waiting.length ? (
          <Empty text="Nothing you're waiting on. Tasks appear here when someone owes you something — set 'waiting on' in a task, or accept a suggestion where someone promised you something." />
        ) : <>
          <Section title="Needs chasing" hint={`waiting ${threshold}+ days`} rows={stale} personOf={personOf}
            onDraft={setDrafting} onDone={id => updateTask(id, { status: "done" })} toast={toast} accent />
          <Section title="Recent" hint="still fresh" rows={recent} personOf={personOf}
            onDraft={setDrafting} onDone={id => updateTask(id, { status: "done" })} toast={toast} />
        </>}
      </PageBody>

      <DraftModal task={drafting} kind="chaser" onClose={() => setDrafting(null)} />
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
      <div className="bg-panel-2 rounded-xl overflow-hidden">
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
