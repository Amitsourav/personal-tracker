"use client";
import { useStore } from "@/lib/store";
import { PageHeader, PageBody } from "@/components/PageHeader";
import { Empty } from "@/components/views/ListView";
import { Check } from "lucide-react";
import { useSignals, SignalRow, SIGNAL_TYPES, SIGNAL_ORDER } from "@/components/Signals";

/**
 * The full grouped view of everything that was understood but is not a task.
 *
 * Review now shows these too, flat and newest-first, because a page you have to
 * remember to open is a page that quietly fills up — Deepak's SEO report sat
 * here unread for a day. This page stays for the grouped read: all the risks
 * together, all the decisions together.
 */
export default function Signals() {
  const { toast } = useStore();
  const { rows, dismiss, makeTask } = useSignals();

  if (rows === null) return null;

  const groups = SIGNAL_ORDER
    .map(t => ({ type: t, ...SIGNAL_TYPES[t], items: rows.filter(r => r.intake_type === t) }))
    .filter(g => g.items.length);

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Signals" count={rows.length}
        hint="Things the AI understood that aren't tasks"
        actions={rows.length ? (
          <button className="btn sm" onClick={() => { dismiss(rows.map(r => r.id)); toast("Cleared"); }}>
            <Check size={13} /> Clear all
          </button>
        ) : undefined} />

      <PageBody className="grid gap-6">
        {!groups.length ? (
          <Empty text="Nothing else to report"
            sub="When a message contains something worth knowing that isn't a task — a decision, a date that moved, a risk — it appears here instead of being thrown away." />
        ) : groups.map(g => (
          <section key={g.type}>
            <h2 className="text-[12px] font-semibold text-ink-2 mb-1.5 flex items-center gap-1.5">
              <g.icon size={13} className={g.tone} />
              {g.label} <span className="text-ink-3 font-normal tnum">{g.items.length}</span>
              <span className="text-ink-3 font-normal text-[11px] hidden sm:inline">· {g.blurb}</span>
            </h2>
            <div className="bg-panel-2 rounded-xl overflow-hidden">
              {g.items.map(s => (
                <SignalRow key={s.id} s={s}
                  onMakeTask={makeTask}
                  onDismiss={ids => { dismiss(ids); toast("Cleared"); }} />
              ))}
            </div>
          </section>
        ))}
      </PageBody>
    </div>
  );
}
