"use client";
import { useState } from "react";
import { Code2, ExternalLink, RefreshCw, ChevronDown, ChevronRight, CircleCheck, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useStore } from "@/lib/store";
import type { Task } from "@/lib/types";

type Commit = { path: string; message?: string | null; author?: string | null; at?: string | null };
type Hint = {
  repo: string | null;
  reason: string;
  confidence: number;
  files: (Commit & { why: string })[];
  maybe_done?: boolean;
  done_commit?: Commit | null;
  done_reason?: string | null;
  done_dismissed_at?: string | null;
};

/**
 * Where in the code to start.
 *
 * Amit writes the code himself, so the expensive part of a task is rarely the
 * work — it is reconstructing, from a sentence somebody typed into WhatsApp,
 * which of four projects it belongs to and which files to open.
 *
 * It asks nothing until pressed. A panel that spends money every time a task is
 * opened is a panel that gets switched off, and most tasks are not code.
 *
 * The answer is presented as a lead, never a fact: "probably", with the
 * reasoning visible and the confidence in words. He is about to open these
 * files, and a confident wrong answer costs him more than an uncertain right one.
 */
export function WhereToStart({ task }: { task: Task }) {
  const { completeTask, toast } = useStore();
  const [hint, setHint] = useState<Hint | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const ask = async (refresh = false) => {
    setBusy(true); setErr(null);
    const res = await fetch("/api/github/locate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id, refresh }),
    });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(j.error ?? "Could not work it out"); return; }
    setHint(j); setOpen(true);
  };

  if (!hint && !err) {
    return (
      <button className="btn sm w-full justify-center" onClick={() => ask()} disabled={busy}>
        <Code2 size={13} className={busy ? "animate-pulse" : ""} />
        {busy ? "Looking through your code…" : "Where do I start?"}
      </button>
    );
  }

  if (err) {
    return (
      <div className="rounded-lg bg-panel-2/60 px-2.5 py-2 text-[11.5px] text-ink-3 flex items-center gap-2">
        <Code2 size={12} className="flex-none" />
        <span className="min-w-0">{err}</span>
        <button className="btn ghost sm ml-auto px-2" onClick={() => { setErr(null); }}>Hide</button>
      </div>
    );
  }

  const h = hint!;

  /**
   * "You already did this."
   *
   * The commits were fetched to give each file some context; they answer a
   * better question. Shown above everything else, because if the work is done
   * the rest of the panel is beside the point.
   *
   * It never closes the task itself. A task that vanishes wrongly is discovered
   * when a client asks why it was never done — so it asks, and Amit answers.
   */
  const done = h.maybe_done && !h.done_dismissed_at && !dismissed
    && task.status !== "done" && task.status !== "cancelled" ? h.done_commit : null;

  const band = h.confidence >= 0.7 ? { label: "Fairly confident", tone: "text-ok" }
    : h.confidence >= 0.4 ? { label: "A reasonable guess", tone: "text-ink-2" }
    : { label: "Not sure — check for yourself", tone: "text-warn" };

  return (
    <div className="grid gap-2">
      {done && (
        <div className="rounded-lg border border-ok/40 bg-ok-soft px-3 py-2.5 grid gap-2">
          <div className="flex items-start gap-2">
            <CircleCheck size={14} className="text-ok mt-0.5 flex-none" />
            <div className="min-w-0 text-[12.5px]">
              <div className="font-semibold">This may already be done</div>
              {h.done_reason && <div className="text-ink-2 mt-0.5">{h.done_reason}</div>}
              <div className="text-ink-3 text-[11.5px] mt-1 break-words">
                <code className="font-mono">{done.path}</code> — “{done.message}”
                {done.at && <> · {formatDistanceToNow(new Date(done.at), { addSuffix: true })}</>}
                {done.author && <> by {done.author}</>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="btn sm" onClick={async () => { await completeTask(task.id); toast("Marked done — confirm it with them when you can"); }}>
              <CircleCheck size={12} /> Tick it off
            </button>
            <button className="btn ghost sm text-[11.5px]" onClick={async () => {
              setDismissed(true);
              await fetch("/api/github/dismiss-done", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskId: task.id }),
              });
            }}>
              <X size={12} /> No, different work
            </button>
          </div>
        </div>
      )}

    <div className="rounded-lg bg-panel-2/60">
      <button className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left text-[11.5px] text-ink-3 hover:text-ink-2"
        onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={12} className="flex-none" /> : <ChevronRight size={12} className="flex-none" />}
        <Code2 size={11} className="text-accent flex-none" />
        <span className="truncate">Where to start{h.repo ? ` · ${h.repo.split("/").pop()}` : ""}</span>
        <span className={`ml-auto flex-none ${band.tone}`}>{band.label}</span>
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 pt-0.5 grid gap-2 text-[12px]">
          {h.reason && <p className="text-ink-2 leading-relaxed">{h.reason}</p>}

          {!h.files.length ? (
            <p className="text-ink-3">
              Nothing in your switched-on repositories looks like this. It may belong to a repo you have not
              connected, or not be code at all.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {h.files.map(f => (
                <li key={f.path} className="grid gap-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <code className="text-[11.5px] font-mono text-ink truncate">{f.path}</code>
                    {h.repo && (
                      <a className="text-accent flex items-center gap-0.5 flex-none text-[11px]"
                        href={`https://github.com/${h.repo}/blob/HEAD/${f.path}`} target="_blank" rel="noreferrer">
                        open <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                  <div className="text-ink-2 text-[11.5px]">{f.why}</div>
                  {f.message && (
                    <div className="text-ink-3 text-[11px] truncate">
                      last changed{f.at ? ` ${formatDistanceToNow(new Date(f.at), { addSuffix: true })}` : ""}
                      {f.author ? ` by ${f.author}` : ""} — “{f.message}”
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2">
            <button className="btn ghost sm px-2 text-[11.5px]" onClick={() => ask(true)} disabled={busy}>
              <RefreshCw size={11} className={busy ? "animate-spin" : ""} /> Look again
            </button>
            <span className="text-[11px] text-ink-3">
              Guessed from file names only — your code was never sent anywhere.
            </span>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
