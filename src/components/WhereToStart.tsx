"use client";
import { useState } from "react";
import { Code2, ExternalLink, RefreshCw, ChevronDown, ChevronRight, CircleCheck, X, Network, TriangleAlert, Stethoscope, Eye, Timer, FileDiff, Copy, HelpCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useStore } from "@/lib/store";
import type { Task } from "@/lib/types";

type Commit = { path: string; message?: string | null; author?: string | null; at?: string | null };
type Diagnosis = {
  cause: string; check_first: string; fix_sketch: string; unknowns: string;
  confidence: number;
  where: { path: string; symbol: string; why: string }[];
  read: { path: string; truncated: boolean }[];
};
type Estimate = {
  low: number; high: number; suggest: number;
  drivers: string[]; confidence: number;
  measured: { path: string; lines: number; symbols: number; tested: boolean }[];
};
type Proposal = {
  ready: boolean; missing: string[]; summary: string; patch: string;
  how_to_check: string; risks: string[]; confidence: number;
  files: { path: string; truncated: boolean }[];
};
type Impact = {
  groups: { file: string; symbols: string[]; refs: { path: string; symbols: string[] }[] }[];
  total: number;
  uncertain?: boolean;
};
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
  const { completeTask, updateTask, toast } = useStore();
  const [hint, setHint] = useState<Hint | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const [est, setEst] = useState<Estimate | null>(null);
  const [estBusy, setEstBusy] = useState(false);
  const [prop, setProp] = useState<Proposal | null>(null);
  const [propBusy, setPropBusy] = useState(false);
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagErr, setDiagErr] = useState<string | null>(null);
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
    setImpact(j.impact ?? null);
    setDiag(j.diagnosis ?? null);
    setEst(j.estimate ?? null);
    setProp(j.proposal ?? null);
  };

  const propose = async () => {
    setPropBusy(true);
    const res = await fetch("/api/github/propose", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    const j = await res.json();
    setPropBusy(false);
    if (res.ok) setProp(j.proposal);
  };

  const estimate = async () => {
    setEstBusy(true);
    const res = await fetch("/api/github/estimate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    const j = await res.json();
    setEstBusy(false);
    if (res.ok) setEst(j.estimate);
  };

  const mins = (n: number) => n < 60 ? `${n} min` : n % 60 === 0 ? `${n / 60} hr` : `${Math.floor(n / 60)}h ${n % 60}m`;

  /**
   * The only button here that sends source code anywhere, which is why it is a
   * separate, deliberate press with the consequence written next to it.
   */
  const diagnose = async () => {
    setDiagBusy(true); setDiagErr(null);
    const res = await fetch("/api/github/diagnose", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    const j = await res.json();
    setDiagBusy(false);
    if (!res.ok) { setDiagErr(j.error ?? "Could not work it out"); return; }
    setDiag(j.diagnosis);
  };

  /**
   * What else uses the things this file defines.
   *
   * Asked for, never automatic: it costs several GitHub code searches, which are
   * rate-limited hard, and most tasks never need it.
   */
  const askImpact = async () => {
    setImpactBusy(true);
    const res = await fetch("/api/github/impact", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    const j = await res.json();
    setImpactBusy(false);
    if (res.ok) setImpact(j.impact);
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

          {/* How long it will take, so the planner stops guessing thirty minutes. */}
          {h.repo && !!h.files.length && (
            est ? (
              <div className="rounded-lg bg-panel px-2.5 py-2 grid gap-1.5">
                <div className="flex items-center gap-1.5 text-[11.5px] flex-wrap">
                  <Timer size={12} className="text-accent" />
                  <span className="font-semibold">{mins(est.low)} – {mins(est.high)}</span>
                  <span className="text-ink-3">at the keyboard</span>
                  {task.duration_min !== est.suggest && (
                    <button className="btn ghost sm px-2 ml-auto text-[11px]"
                      onClick={() => { updateTask(task.id, { duration_min: est.suggest }); toast(`Planner will allow ${mins(est.suggest)}`); }}>
                      Use {mins(est.suggest)}
                    </button>
                  )}
                </div>
                {!!est.drivers.length && (
                  <ul className="text-[11px] text-ink-3 grid gap-0.5">
                    {est.drivers.map((d, i) => <li key={i}>· {d}</li>)}
                  </ul>
                )}
              </div>
            ) : (
              <button className="btn sm w-full justify-center" onClick={estimate} disabled={estBusy}>
                <Timer size={12} className={estBusy ? "animate-pulse" : ""} />
                {estBusy ? "Measuring the files…" : "How long will this take?"}
              </button>
            )
          )}

          {/* Symptom to cause. */}
          {h.repo && !!h.files.length && (
            diag ? (
              <div className="rounded-lg bg-panel px-2.5 py-2.5 grid gap-2">
                <div className="flex items-center gap-1.5 text-[11.5px]">
                  <Stethoscope size={12} className="text-accent" />
                  <span className="font-semibold">What is probably wrong</span>
                  <span className={`ml-auto ${diag.confidence >= 0.6 ? "text-ok" : diag.confidence >= 0.35 ? "text-ink-3" : "text-warn"}`}>
                    {diag.confidence >= 0.6 ? "Fairly confident" : diag.confidence >= 0.35 ? "A theory" : "A guess"}
                  </span>
                </div>

                <p className="text-[12.5px] text-ink leading-relaxed">{diag.cause}</p>

                {!!diag.where.length && (
                  <div className="grid gap-0.5">
                    {diag.where.map(w => (
                      <div key={w.path + w.symbol} className="text-[11.5px] min-w-0">
                        <a className="font-mono text-ink hover:text-accent"
                          href={`https://github.com/${h.repo}/blob/HEAD/${w.path}`} target="_blank" rel="noreferrer">
                          {w.path}
                        </a>
                        {w.symbol && <span className="text-accent"> · {w.symbol}</span>}
                        <div className="text-ink-3">{w.why}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid gap-1 text-[11.5px]">
                  <div><span className="text-ink-3">Check first — </span><span className="text-ink-2">{diag.check_first}</span></div>
                  <div><span className="text-ink-3">Fix is probably — </span><span className="text-ink-2">{diag.fix_sketch}</span></div>
                  {diag.unknowns && (
                    <div className="flex items-start gap-1 text-ink-3">
                      <Eye size={11} className="mt-0.5 flex-none" />
                      <span>Could not see: {diag.unknowns}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid gap-1">
                <button className="btn sm w-full justify-center" onClick={diagnose} disabled={diagBusy}>
                  <Stethoscope size={12} className={diagBusy ? "animate-pulse" : ""} />
                  {diagBusy ? "Reading the code…" : "What is actually wrong?"}
                </button>
                <p className="text-[10.5px] text-ink-3 text-center">
                  The only button here that sends these files&apos; contents to the AI.
                </p>
                {diagErr && <p className="text-[11px] text-warn text-center">{diagErr}</p>}
              </div>
            )
          )}

          {/* What else this touches. The question that costs a weekend. */}
          {h.repo && !!h.files.length && (
            impact ? (
              <div className="rounded-lg bg-panel px-2.5 py-2 grid gap-1.5">
                <div className="flex items-center gap-1.5 text-[11.5px]">
                  <Network size={12} className={impact.total ? "text-warn" : "text-ink-3"} />
                  <span className="font-semibold">
                    {impact.uncertain
                      ? "Could not check what else uses this"
                      : impact.total
                        ? `${impact.total} other file${impact.total === 1 ? "" : "s"} use${impact.total === 1 ? "s" : ""} this`
                        : "Nothing else appears to use this"}
                  </span>
                </div>
                {impact.uncertain && (
                  <p className="text-[11px] text-ink-3 flex items-start gap-1">
                    <TriangleAlert size={11} className="mt-0.5 flex-none" />
                    GitHub code search returned nothing — it can lag behind a push. Treat this as unknown, not as safe.
                  </p>
                )}
                {impact.groups.filter(g => g.refs.length).map(g => (
                  <div key={g.file} className="grid gap-0.5">
                    <div className="text-[11px] text-ink-3">
                      Change <code className="font-mono">{g.file.split("/").pop()}</code> and you touch:
                    </div>
                    {g.refs.map(r => (
                      <div key={r.path} className="flex items-baseline gap-1.5 min-w-0">
                        <a className="text-[11.5px] font-mono text-ink truncate hover:text-accent"
                          href={`https://github.com/${h.repo}/blob/HEAD/${r.path}`} target="_blank" rel="noreferrer">
                          {r.path}
                        </a>
                        <span className="text-[10.5px] text-ink-3 flex-none">{r.symbols.join(", ")}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <button className="btn sm w-full justify-center" onClick={askImpact} disabled={impactBusy}>
                <Network size={12} className={impactBusy ? "animate-pulse" : ""} />
                {impactBusy ? "Checking what else uses this…" : "What else does this touch?"}
              </button>
            )
          )}

          {/* The first draft of the change. Last, because a confident wrong
              patch costs more to review than no patch at all. */}
          {h.repo && !!h.files.length && (
            prop ? (
              prop.ready ? (
                <div className="rounded-lg bg-panel px-2.5 py-2.5 grid gap-2">
                  <div className="flex items-center gap-1.5 text-[11.5px]">
                    <FileDiff size={12} className="text-accent" />
                    <span className="font-semibold">A first draft</span>
                    <span className={`ml-auto ${prop.confidence >= 0.6 ? "text-ok" : "text-warn"}`}>
                      {prop.confidence >= 0.6 ? "Worth reading" : "Read it carefully"}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-ink leading-relaxed">{prop.summary}</p>

                  <pre className="bg-panel-2 rounded-lg p-2.5 text-[10.5px] font-mono leading-[1.5] overflow-x-auto max-h-[320px] overflow-y-auto">
                    {prop.patch.split("\n").map((l, i) => (
                      <div key={i} className={
                        l.startsWith("+++") || l.startsWith("---") ? "text-ink-3"
                        : l.startsWith("@@") ? "text-accent"
                        : l.startsWith("+") ? "text-ok"
                        : l.startsWith("-") ? "text-danger" : "text-ink-2"
                      }>{l || " "}</div>
                    ))}
                  </pre>

                  <div className="grid gap-1 text-[11.5px]">
                    <div><span className="text-ink-3">How to check — </span><span className="text-ink-2">{prop.how_to_check}</span></div>
                    {prop.risks.map((r, i) => (
                      <div key={i} className="flex items-start gap-1 text-warn">
                        <TriangleAlert size={11} className="mt-0.5 flex-none" /><span>{r}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button className="btn sm" onClick={async () => {
                      try { await navigator.clipboard.writeText(prop.patch); toast("Patch copied — git apply"); }
                      catch { toast("Could not copy"); }
                    }}><Copy size={12} /> Copy patch</button>
                    <button className="btn ghost sm px-2 text-[11.5px]" onClick={() => setProp(null)}><X size={12} /> Discard</button>
                    <span className="text-[10.5px] text-ink-3">
                      Nothing was pushed. Save it as a file and <code className="font-mono">git apply</code>.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-panel px-2.5 py-2.5 grid gap-1.5">
                  <div className="flex items-center gap-1.5 text-[11.5px]">
                    <HelpCircle size={12} className="text-warn" />
                    <span className="font-semibold">Not enough to go on</span>
                    <button className="btn ghost sm px-2 ml-auto text-[11px]" onClick={() => setProp(null)}>Hide</button>
                  </div>
                  <p className="text-[11.5px] text-ink-2">It would need to know:</p>
                  <ul className="text-[11.5px] text-ink-2 grid gap-0.5">
                    {prop.missing.map((m, i) => <li key={i}>· {m}</li>)}
                  </ul>
                  <p className="text-[10.5px] text-ink-3">
                    Refusing is usually the right answer. A confident wrong patch costs more to read than none.
                  </p>
                </div>
              )
            ) : (
              <button className="btn sm w-full justify-center" onClick={propose} disabled={propBusy}>
                <FileDiff size={12} className={propBusy ? "animate-pulse" : ""} />
                {propBusy ? "Writing a first draft…" : "Draft the change"}
              </button>
            )
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
