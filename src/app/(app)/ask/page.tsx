"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { PriorityFlag } from "@/components/ui";
import { fmtDue } from "@/lib/dates";
import { Sparkles, RefreshCw, CornerDownLeft } from "lucide-react";
import { PageHeader, PageBody } from "@/components/PageHeader";

type Cited = { id: string; title: string; status: string; priority: number; due_at: string | null; review_state: string };
type Answer = { question: string; answer: string; tasks: Cited[]; truncated: boolean; total: number };

const SUGGESTIONS = [
  "What's overdue?",
  "What did I promise people this week?",
  "Who am I waiting on the longest?",
  "What's due in the next three days?",
  "What came from WhatsApp that I haven't reviewed?",
];

/**
 * Plain-English questions over the task list.
 *
 * Answers cite the tasks they used and link to them, so a wrong answer is
 * visible rather than plausible — the failure mode that matters when a model
 * summarises your own commitments back to you.
 */
export default function Ask() {
  const { select } = useStore();
  const [q, setQ] = useState("");
  const [history, setHistory] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || loading) return;
    setLoading(true); setError(null); setQ("");
    const r = await fetch("/api/ai/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text }),
    });
    const j = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) { setError(j.error ?? `Failed (${r.status})`); setQ(text); return; }
    setHistory(h => [{ question: text, answer: j.answer, tasks: j.tasks ?? [], truncated: !!j.truncated, total: j.total ?? 0 }, ...h]);
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Ask" hint="Questions about your own tasks, answered from your own data" />

      <PageBody>
        <div className="grid gap-4 max-w-[720px]">
          <form onSubmit={e => { e.preventDefault(); ask(q); }} className="flex gap-2">
            <input
              className="field flex-1" autoFocus
              placeholder="What's overdue? Who am I waiting on?"
              value={q} onChange={e => setQ(e.target.value)} />
            <button className="btn primary" disabled={loading || !q.trim()}>
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <CornerDownLeft size={14} />} Ask
            </button>
          </form>

          {!history.length && !loading && (
            <div className="grid gap-1.5">
              <div className="text-[11.5px] text-ink-3">Try:</div>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map(s => (
                  <button key={s} className="btn sm" onClick={() => ask(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {error && <div className="text-[12.5px] text-danger">{error}</div>}

          {history.map((h, i) => (
            <div key={i} className="grid gap-2.5 bg-panel-2 rounded-xl p-4 fade-in">
              <div className="text-[12px] text-ink-3">{h.question}</div>
              <div className="text-[13.5px] leading-relaxed flex gap-2">
                <Sparkles size={14} className="text-accent mt-1 flex-none" />
                <span className="whitespace-pre-wrap">{h.answer}</span>
              </div>
              {h.tasks.length > 0 && (
                <div className="grid gap-0.5 pl-6">
                  {h.tasks.map(t => (
                    <button key={t.id} onClick={() => select(t.id)}
                      className="flex items-center gap-2 text-[12.5px] text-left row-hover rounded px-1.5 py-1 min-w-0">
                      <PriorityFlag p={t.priority} />
                      <span className="truncate">{t.title}</span>
                      {t.review_state === "suggested" && <span className="pill text-[10.5px] bg-accent-soft text-accent shrink-0">in review</span>}
                      {t.due_at && <span className="text-[11px] text-ink-3 shrink-0 ml-auto">{fmtDue(t.due_at)}</span>}
                    </button>
                  ))}
                </div>
              )}
              {h.truncated && (
                <div className="text-[11px] text-ink-3 pl-6">
                  Answered from your 300 most recent tasks of {h.total}.
                </div>
              )}
            </div>
          ))}
        </div>
      </PageBody>
    </div>
  );
}
