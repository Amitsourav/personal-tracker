"use client";
import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { Modal } from "@/components/ui";
import { Copy, RefreshCw } from "lucide-react";
import type { Task } from "@/lib/types";

/**
 * Shows an AI-written message for approval and copies it. Never sends.
 *
 * "chaser" nudges someone about something they owe Amit; "ack" confirms
 * something he has just accepted. Shared by Review and Follow-ups so the two
 * cannot drift apart in tone or behaviour.
 */
export function DraftModal({ task, kind, onClose }: {
  task: Task | null;
  kind: "chaser" | "ack";
  onClose: () => void;
}) {
  const { toast } = useStore();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const generate = useCallback(async (t: Task) => {
    setLoading(true); setError(null);
    const r = await fetch("/api/ai/draft", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: t.id, kind }),
    });
    const j = await r.json().catch(() => ({}));
    setLoading(false);
    if (!r.ok) { setError(j.error ?? `Failed (${r.status})`); return; }
    setText(j.text); setLoadedFor(t.id);
  }, [kind]);

  // Draft once per task on open. Rewriting is explicit, so a failure does not
  // retry on every render and quietly spend the budget.
  useEffect(() => {
    if (task && loadedFor !== task.id) { setText(""); setError(null); generate(task); }
  }, [task, loadedFor, generate]);

  const close = () => { setText(""); setLoadedFor(null); setError(null); onClose(); };

  return (
    <Modal open={!!task} onClose={close}>
      <div className="p-4 grid gap-3">
        <div>
          <h2 className="font-semibold text-[14px]">
            {kind === "chaser" ? "Chaser message" : "Reply to send"}
          </h2>
          <p className="text-[11.5px] text-ink-3 mt-0.5">
            {kind === "chaser"
              ? "Edit anything you like, then copy it. Tracker never sends messages for you."
              : "Let them know you have it and when it will be done. Edit, copy, send it yourself."}
          </p>
        </div>
        {task && <div className="text-[12px] text-ink-2 bg-panel-2 rounded p-2 truncate">{task.title}</div>}
        {loading ? (
          <div className="text-[12.5px] text-ink-3 flex items-center gap-2 py-6 justify-center">
            <RefreshCw size={13} className="animate-spin" /> Writing…
          </div>
        ) : error ? (
          <div className="text-[12.5px] text-danger">{error}</div>
        ) : (
          <textarea
            className="bg-panel-2 rounded p-2 outline-none text-[13px] text-ink min-h-[120px] resize-y leading-relaxed"
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
          <button className="btn sm ml-auto" onClick={close}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
