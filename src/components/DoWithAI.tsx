"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Sparkles, RefreshCw, Copy, FileDown, Handshake, Plus, X } from "lucide-react";
import type { Task } from "@/lib/types";

type Kind = "draft" | "summary" | "outline";
const LABEL: Record<Kind, string> = { draft: "Draft the reply", summary: "Summarise", outline: "Break into steps" };

/**
 * Have the AI attempt the task and hand back the result.
 *
 * Output is never applied automatically. It is shown, editable, and saved only
 * when asked — the same rule the rest of the app follows for anything the AI
 * produces in the user's name.
 */
type Promise_ = { title: string; quote: string; due_iso: string | null };

export function DoWithAI({ task }: { task: Task }) {
  const { updateTask, addTask, toast } = useStore();
  // What the draft just committed him to. The tracker catches promises he types
  // himself; it did not catch the ones it wrote for him, which is a system
  // manufacturing obligations and then forgetting them.
  const [promises, setPromises] = useState<Promise_[] | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind | null>(null);
  const [loading, setLoading] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noContext, setNoContext] = useState(false);

  async function run(k: Kind) {
    setLoading(k); setError(null);
    const r = await fetch("/api/ai/do", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, kind: k }),
    });
    const j = await r.json().catch(() => ({}));
    setLoading(null);
    if (!r.ok) { setError(j.error ?? `Failed (${r.status})`); return; }
    setText(j.text); setKind(k); setNoContext(!j.had_context);
    setPromises(null);
    // Only a reply can commit him to anything; a summary or a checklist cannot.
    if (k === "draft" && j.text) {
      fetch("/api/ai/promises-in-draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: j.text, taskId: task.id }),
      })
        .then(res => res.json())
        .then(p => setPromises(p.promises ?? []))
        .catch(() => setPromises([]));
    }
  }

  return (
    <div>
      <div className="text-[11px] font-semibold text-ink-3 uppercase tracking-wide mb-1 flex items-center gap-1">
        <Sparkles size={11} className="text-accent" /> Do this with AI
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(LABEL) as Kind[]).map(k => (
          <button key={k} className="btn sm" disabled={!!loading} onClick={() => run(k)}>
            {loading === k ? <RefreshCw size={12} className="animate-spin" /> : null} {LABEL[k]}
          </button>
        ))}
      </div>

      {error && <div className="text-[12px] text-danger mt-1.5">{error}</div>}

      {kind && !error && (
        <div className="mt-2 grid gap-1.5">
          {noContext && (
            <div className="text-[11px] text-ink-3">
              No stored conversation for this task, so this is written from the title and notes alone.
            </div>
          )}
          <textarea
            className="bg-panel-2 rounded p-2 outline-none text-[12.5px] text-ink min-h-[140px] resize-y leading-relaxed border border-line-2"
            value={text} onChange={e => setText(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            <button className="btn sm" onClick={async () => {
              await navigator.clipboard.writeText(text);
              toast("Copied");
            }}><Copy size={12} /> Copy</button>
            <button className="btn sm" onClick={async () => {
              const next = [task.description?.trim(), text.trim()].filter(Boolean).join("\n\n---\n\n");
              await updateTask(task.id, { description: next });
              toast("Saved to notes");
            }}><FileDown size={12} /> Save to notes</button>
            <button className="btn sm" disabled={!!loading} onClick={() => run(kind)}>
              <RefreshCw size={12} /> Again
            </button>
          </div>
          <div className="text-[11px] text-ink-3">
            Written from your own messages only — it has no internet access, so check anything factual.
          </div>

          {!!promises?.length && (
            <div className="rounded-lg border border-warn/40 bg-panel-2 px-3 py-2.5 grid gap-2">
              <div className="flex items-start gap-2 text-[12.5px]">
                <Handshake size={13} className="text-warn mt-0.5 flex-none" />
                <div>
                  <div className="font-semibold">Sending this promises something</div>
                  <div className="text-ink-3 text-[11.5px] mt-0.5">
                    Beyond this task. Add it, or it is a thing you owe that nobody is tracking.
                  </div>
                </div>
              </div>
              {promises.map((p, i) => (
                <div key={i} className="grid gap-1">
                  <div className="text-[12.5px]">{p.title}</div>
                  <div className="text-[11.5px] text-ink-3 italic">“{p.quote}”</div>
                  <div className="flex gap-1.5">
                    <button className="btn sm" onClick={async () => {
                      await addTask({
                        title: p.title.slice(0, 200),
                        status: "todo", priority: 2,
                        due_at: p.due_iso || null,
                        person_id: task.person_id,
                        source_kind: "manual",
                        source_quote: p.quote?.slice(0, 300) ?? null,
                        ai_meta: { kind: "promise", from: "drafted reply", task: task.title },
                      });
                      setPromises(ps => (ps ?? []).filter((_, j) => j !== i));
                      toast("Added — you owe this now");
                    }}><Plus size={12} /> Add it</button>
                    <button className="btn ghost sm text-[11.5px]"
                      onClick={() => setPromises(ps => (ps ?? []).filter((_, j) => j !== i))}>
                      <X size={12} /> Not a promise
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
