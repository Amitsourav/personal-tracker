"use client";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, AlertCircle, RefreshCw, ExternalLink } from "lucide-react";

interface Secrets { openrouter_key: string | null; model_extract: string; model_plan: string; monthly_cap_usd: number; google_client_id: string | null; google_client_secret: string | null; google_email: string | null; google_refresh_token: string | null; gmail_last_sync_at: string | null; gmail_enabled: boolean; gmail_ignore_senders: string[] }
interface Run { id: string; channel: string; started_at: string; finished_at: string | null; fetched: number; candidates: number; created_tasks: number; error: string | null }

const MODELS = [
  ["openai/gpt-4o-mini", "GPT-4o mini — cheap, good for reading mail"],
  ["openai/gpt-4.1-mini", "GPT-4.1 mini"],
  ["google/gemini-2.5-flash", "Gemini 2.5 Flash — cheap, strong on Hindi"],
  ["google/gemini-3.7-flash", "Gemini 3.7 Flash — fast, strong on Hinglish"],
  ["anthropic/claude-3.5-haiku", "Claude 3.5 Haiku"],
  ["anthropic/claude-sonnet-4", "Claude Sonnet 4"],
  ["anthropic/claude-sonnet-5", "Claude Sonnet 5 — best quality"],
  ["openai/gpt-4.1", "GPT-4.1"],
];

const mask = (k: string | null) => k ? k.slice(0, 8) + "••••••••" + k.slice(-4) : "";

export function IntegrationsSettings() {
  const { userId, toast } = useStore();
  const params = useSearchParams();
  const [s, setS] = useState<Secrets | null>(null);
  const [spend, setSpend] = useState(0);
  const [runs, setRuns] = useState<Run[]>([]);
  const [keyInput, setKeyInput] = useState("");
  const [cid, setCid] = useState(""); const [csec, setCsec] = useState("");
  const [syncing, setSyncing] = useState(false);
  const sb = createClient();

  const load = useCallback(async function load(): Promise<void> {
    if (!userId) return;
    const [{ data }, { data: sp }, { data: rs }] = await Promise.all([
      sb.from("user_secrets").select("*").eq("user_id", userId).maybeSingle(),
      sb.rpc("month_spend", { uid: userId }),
      sb.from("sync_runs").select("*").order("started_at", { ascending: false }).limit(5),
    ]);
    if (!data) { await sb.from("user_secrets").insert({ user_id: userId }); return load(); }
    setS(data as Secrets); setSpend(Number(sp ?? 0)); setRuns((rs ?? []) as Run[]);
    setCid((data as Secrets).google_client_id ?? "");
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const e = params.get("error"); const c = params.get("connected");
    if (c === "google") toast("Gmail connected");
    if (e) toast({ no_client: "Add your Google client ID and secret first", state: "Sign-in check failed — try again", no_refresh: "Google didn't give long-term access. Remove the app at myaccount.google.com/permissions and connect again.", access_denied: "You cancelled Google access" }[e] ?? `Google error: ${e}`);
  }, [params, toast]);

  const save = async (patch: Partial<Secrets>) => { if (!userId) return; setS(x => x ? { ...x, ...patch } : x); const { error } = await sb.from("user_secrets").update(patch).eq("user_id", userId); if (error) toast("Save failed: " + error.message); else toast("Saved"); };

  async function syncNow() {
    setSyncing(true);
    const r = await fetch("/api/sync/gmail", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setSyncing(false);
    toast(r.ok ? `Checked ${j.fetched ?? 0} emails, suggested ${j.created_tasks ?? 0} tasks` : `Sync failed: ${j.error ?? r.status}`);
    load();
  }

  if (!s) return null;
  const lastRun = runs[0];
  return (
    <>
      <Section title="AI (OpenRouter)" hint="Your key stays in your own database and is only used for your tasks. Get one at openrouter.ai/keys.">
        <Row label="API key">
          {s.openrouter_key && !keyInput ? <div className="flex items-center gap-2"><code className="text-[12px] text-ink-2">{mask(s.openrouter_key)}</code><CheckCircle2 size={14} className="text-ok" /><button className="btn sm" onClick={() => setKeyInput(" ")}>Replace</button></div>
            : <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (keyInput.trim()) { save({ openrouter_key: keyInput.trim() }); setKeyInput(""); } }}><input id="or-key" className="field font-mono text-[12px]" placeholder="sk-or-v1-…" value={keyInput.trim()} onChange={e => setKeyInput(e.target.value)} /><button className="btn primary sm">Save</button></form>}
        </Row>
        <Row label="Reading model"><select className="field" value={s.model_extract} onChange={e => save({ model_extract: e.target.value })}>{MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Row>
        <Row label="Planning model"><select className="field" value={s.model_plan} onChange={e => save({ model_plan: e.target.value })}>{MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Row>
        <Row label="Monthly cap"><div className="flex items-center gap-2">$<input type="number" min={1} className="field w-[90px] tnum" defaultValue={s.monthly_cap_usd} onBlur={e => save({ monthly_cap_usd: Number(e.target.value) || 10 })} /><span className="text-ink-3 text-[12px]">spent this month: <b className="text-ink tnum">${spend.toFixed(2)}</b></span></div></Row>
      </Section>

      <Section title="Google — Gmail & Calendar" hint="One-time setup with your own Google credentials. I'll walk you through creating them.">
        {s.google_refresh_token ? (
          <>
            <Row label="Connected as"><div className="flex items-center gap-2 text-[12.5px]"><CheckCircle2 size={14} className="text-ok" /> {s.google_email}<button className="btn sm ml-2" onClick={async () => { await fetch("/api/google/disconnect", { method: "POST" }); load(); }}>Disconnect</button></div></Row>
            <Row label="Read Gmail"><label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={s.gmail_enabled} onChange={e => save({ gmail_enabled: e.target.checked })} /> Check for new tasks every 5 minutes</label></Row>
            <Row label="Ignore senders"><input className="field" placeholder="comma separated emails or domains, e.g. noreply@, @linkedin.com" defaultValue={s.gmail_ignore_senders.join(", ")} onBlur={e => save({ gmail_ignore_senders: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })} /></Row>
            <Row label="Last check">
              <div className="flex items-center gap-2 text-[12.5px]">
                {lastRun ? <span className={lastRun.error ? "text-danger flex items-center gap-1" : "text-ink-2"}>{lastRun.error && <AlertCircle size={13} />}{formatDistanceToNow(new Date(lastRun.started_at), { addSuffix: true })} · {lastRun.fetched} emails, {lastRun.created_tasks} suggested{lastRun.error && ` · ${lastRun.error}`}</span> : <span className="text-ink-3">Never</span>}
                <button className="btn sm" onClick={syncNow} disabled={syncing || !s.openrouter_key}><RefreshCw size={12} className={syncing ? "animate-spin" : ""} /> Sync now</button>
              </div>
            </Row>
            {!s.openrouter_key && <div className="text-[12px] text-warn">Add your OpenRouter key above before syncing.</div>}
          </>
        ) : (
          <>
            <Row label="Client ID"><input id="g-cid" className="field font-mono text-[12px]" placeholder="…apps.googleusercontent.com" value={cid} onChange={e => setCid(e.target.value)} onBlur={() => save({ google_client_id: cid.trim() || null })} /></Row>
            <Row label="Client secret"><input id="g-csec" type="password" className="field font-mono text-[12px]" placeholder={s.google_client_secret ? "•••••••• (saved)" : "GOCSPX-…"} value={csec} onChange={e => setCsec(e.target.value)} onBlur={() => { if (csec.trim()) { save({ google_client_secret: csec.trim() }); setCsec(""); } }} /></Row>
            <div className="flex items-center gap-2">
              <a className={`btn primary sm ${!(s.google_client_id && s.google_client_secret) ? "pointer-events-none opacity-50" : ""}`} href="/api/google/start">Connect Gmail & Calendar <ExternalLink size={12} /></a>
              <span className="text-[11.5px] text-ink-3">Google will show an “unverified app” warning — that&apos;s expected for a personal app. Click Advanced → Go to Tracker.</span>
            </div>
          </>
        )}
      </Section>
    </>
  );
}
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) { return <section className="bg-panel border border-line rounded-lg p-4 grid gap-3"><div><h2 className="font-semibold text-[13px]">{title}</h2>{hint && <p className="text-[11.5px] text-ink-3 mt-0.5">{hint}</p>}</div>{children}</section>; }
function Row({ label, children }: { label: string; children: React.ReactNode }) { return <div className="grid grid-cols-[130px_1fr] items-center gap-2 text-[12.5px]"><span className="text-ink-2">{label}</span>{children}</div>; }
