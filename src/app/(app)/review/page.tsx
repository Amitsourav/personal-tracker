"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Empty } from "@/components/views/ListView";
import { PriorityFlag, Avatar } from "@/components/ui";
import { fmtDue } from "@/lib/dates";
import { Check, X, Sparkles, ExternalLink, Pencil, MessageSquare, Radar } from "lucide-react";
import { DraftModal } from "@/components/DraftModal";
import { Why } from "@/components/Why";
import type { Task } from "@/lib/types";
import { PageHeader, PageBody } from "@/components/PageHeader";
import { useSignals, SignalRow, sortSignals } from "@/components/Signals";

/**
 * One place to triage, rather than two.
 *
 * Suggested tasks needed accepting here; everything else the AI understood —
 * the decision someone is waiting on, the risk, the report that mentions a
 * deadline in passing — sat on the Signals page, which has no badge and so was
 * never opened. Deepak's weekly SEO report spent a day there unread. Both now
 * surface in the same place: tasks first, because they are the ones asking for
 * a yes or no, then the rest below.
 */
export default function Review() {
  const { tasks, people, projects, updateTask, updatePerson, select, toast } = useStore();
  const [replyTo, setReplyTo] = useState<Task | null>(null);
  const { rows: signalRows, dismiss, makeTask } = useSignals();
  const suggested = tasks.filter(t => t.review_state === "suggested").sort((a, b) => b.created_at.localeCompare(a.created_at));
  const signals = sortSignals(signalRows ?? []);
  const nothingWaiting = !suggested.length && !signals.length;
  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Review" count={suggested.length + signals.length}
        hint="What the AI found in your messages. Nothing is added until you accept it."
        actions={suggested.length > 1 ? (
          <button className="btn sm" onClick={() => { suggested.forEach(t => updateTask(t.id, { review_state: "accepted" })); toast(`Accepted ${suggested.length} tasks`); }}><Check size={13} /> Accept all</button>
        ) : undefined} />
      <PageBody className="grid gap-6">
        {nothingWaiting ? (
          <Empty text="Nothing to review" sub="Once Gmail and WhatsApp are connected (Phase 2–3), suggested tasks will appear here for you to accept or reject." />
        ) : (
          <>
          {suggested.length > 0 && (
          <div className="grid gap-2.5">
            {suggested.map(t => {
              const person = people.find(p => p.id === t.person_id); const project = projects.find(p => p.id === t.project_id);
              return (
                <div key={t.id} className="bg-panel-2 rounded-xl p-4 grid gap-2.5 fade-in">
                  <div className="flex items-start gap-2">
                    <Sparkles size={14} className="text-accent mt-0.5 flex-none" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[13.5px]">{t.title}</div>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-[11.5px] text-ink-2">
                        <PriorityFlag p={t.priority} />
                        {t.due_at && <span className="pill bg-accent-soft text-accent">{fmtDue(t.due_at, t.due_has_time)}</span>}
                        {person && <span className="flex items-center gap-1"><Avatar name={person.name} size={14} /> {person.name}</span>}
                        {project && <span className="pill"><span className="w-[7px] h-[7px] rounded-[2px]" style={{ background: project.color }} /> {project.name}</span>}
                        <span className="text-ink-3">via {t.source_kind}{t.confidence != null && ` · ${Math.round(t.confidence * 100)}%`}</span>
                        {t.source_link && <a className="text-accent flex items-center gap-0.5" href={t.source_link} target="_blank" rel="noreferrer">source <ExternalLink size={10} /></a>}
                      </div>
                      <div className="mt-2"><Why task={t} open /></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 pl-6">
                    <button className="btn primary sm" onClick={() => { updateTask(t.id, { review_state: "accepted" }); toast("Accepted"); }}><Check size={13} /> Accept</button>
                    {person && (t.ai_meta as { kind?: string }).kind !== "commitment" && (
                      <button className="btn sm" title={`Accept and draft a reply to ${person.name}`}
                        onClick={() => { updateTask(t.id, { review_state: "accepted" }); setReplyTo(t); toast("Accepted"); }}>
                        <MessageSquare size={13} /> Accept &amp; reply
                      </button>
                    )}
                    <button className="btn sm" onClick={() => select(t.id)}><Pencil size={13} /> Edit</button>
                    <button className="btn ghost sm text-danger" onClick={() => { updateTask(t.id, { review_state: "rejected" }); toast("Rejected"); }}><X size={13} /> Reject</button>
                    {person && person.trust_level === "review" && <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-3">{person.name}:<button className="btn ghost sm" onClick={() => { updatePerson(person.id, { trust_level: "auto_accept" }); toast(`Tasks from ${person.name} will be added automatically`); }}>always accept</button><button className="btn ghost sm" onClick={() => { updatePerson(person.id, { trust_level: "ignore" }); updateTask(t.id, { review_state: "rejected" }); toast(`Ignoring ${person.name}`); }}>ignore</button></span>}
                  </div>
                </div>
              );
            })}
          </div>
          )}

          {signals.length > 0 && (
            <section>
              <h2 className="text-[12px] font-semibold text-ink-2 mb-1.5 flex items-center gap-1.5">
                <Radar size={13} className="text-ink-3" />
                Also worth a look <span className="text-ink-3 font-normal tnum">{signals.length}</span>
                <span className="text-ink-3 font-normal text-[11px] hidden sm:inline">· understood, but not a task</span>
                <button className="btn ghost sm ml-auto" onClick={() => { dismiss(signals.map(s => s.id)); toast("Cleared"); }}>
                  <Check size={13} /> Clear all
                </button>
              </h2>
              <div className="bg-panel-2 rounded-xl overflow-hidden">
                {signals.map(s => (
                  <SignalRow key={s.id} s={s} showType
                    onMakeTask={makeTask}
                    onDismiss={ids => { dismiss(ids); toast("Cleared"); }} />
                ))}
              </div>
            </section>
          )}
          </>
        )}
      </PageBody>
      <DraftModal task={replyTo} kind="ack" onClose={() => setReplyTo(null)} />
    </div>
  );
}
