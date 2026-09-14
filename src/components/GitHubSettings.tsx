"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { formatDistanceToNow } from "date-fns";
import { GitBranch, RefreshCw, CheckCircle2, AlertTriangle, Lock } from "lucide-react";

type Repo = {
  id: string; full_name: string; description: string | null; language: string | null;
  private: boolean; enabled: boolean; pushed_at: string | null;
  path_count: number | null; indexed_at: string | null; index_error: string | null;
};

/**
 * Connecting GitHub, so a task can say where in the code to start.
 *
 * Two deliberate frictions. Repositories arrive switched OFF — connecting an
 * account should not silently start reading forty years of forks. And a repo is
 * only read when Amit switches it on, so the list of what has been indexed is
 * always a list of what he chose.
 */
export function GitHubSettings() {
  const { toast } = useStore();
  const sb = createClient();
  const [login, setLogin] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const [{ data: sec }, { data: r }] = await Promise.all([
      sb.from("user_secrets").select("github_token,github_login").maybeSingle(),
      sb.from("github_repos").select("id,full_name,description,language,private,enabled,pushed_at,path_count,indexed_at,index_error")
        .order("enabled", { ascending: false }).order("pushed_at", { ascending: false, nullsFirst: false }),
    ]);
    setHasToken(!!sec?.github_token);
    setLogin(sec?.github_login ?? null);
    setRepos((r ?? []) as Repo[]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  if (repos === null) return null;

  const saveToken = async (tok: string) => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    setBusy("token");
    const { error } = await sb.from("user_secrets").update({ github_token: tok }).eq("user_id", user.id);
    if (error) { setBusy(null); return toast("Save failed: " + error.message); }
    setTokenInput("");
    await refreshRepos();
  };

  const refreshRepos = async () => {
    setBusy("repos");
    const res = await fetch("/api/github/repos", { method: "POST" });
    const j = await res.json();
    setBusy(null);
    if (!res.ok) return toast(j.error ?? "Could not reach GitHub");
    toast(`Connected as ${j.login} · ${j.count} repositories`);
    load();
  };

  const toggle = async (r: Repo) => {
    const on = !r.enabled;
    setRepos(rs => (rs ?? []).map(x => x.id === r.id ? { ...x, enabled: on } : x));
    await sb.from("github_repos").update({ enabled: on }).eq("id", r.id);
    // Switching a repo on is the moment to read it: anything else leaves an
    // enabled repo that silently answers nothing.
    if (on && !r.indexed_at) await index(r.full_name);
  };

  const index = async (fullName: string) => {
    setBusy(fullName);
    const res = await fetch("/api/github/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName }) });
    const j = await res.json();
    setBusy(null);
    toast(res.ok ? `${fullName}: ${j.files} files read` : (j.error ?? "Could not read that repository"));
    load();
  };

  const shown = (repos ?? []).filter(r => !filter || r.full_name.toLowerCase().includes(filter.toLowerCase()));
  const on = repos.filter(r => r.enabled).length;

  return (
    <section className="bg-panel-2 rounded-xl p-5 grid gap-3.5">
      <div>
        <h2 className="font-semibold text-[13px] flex items-center gap-1.5"><GitBranch size={13} /> GitHub</h2>
        <p className="text-[11.5px] text-ink-3 mt-0.5">
          So a task can tell you which files to open. Read-only — Tracker cannot push, merge or delete anything.
        </p>
      </div>

      <div className="grid grid-cols-[130px_1fr] items-start gap-2 text-[12.5px]">
        <span className="text-ink-2 pt-1.5">Token</span>
        {hasToken && !tokenInput ? (
          <div className="flex items-center gap-2 flex-wrap">
            <CheckCircle2 size={14} className="text-ok flex-none" />
            <span className="text-ink-2">{login ? <>Connected as <b>{login}</b></> : "Connected"}</span>
            <button className="btn sm" onClick={refreshRepos} disabled={busy === "repos"}>
              <RefreshCw size={12} className={busy === "repos" ? "animate-spin" : ""} /> Refresh repos
            </button>
            <button className="btn ghost sm" onClick={() => setTokenInput(" ")}>Replace</button>
          </div>
        ) : (
          <form className="grid gap-1.5" onSubmit={e => { e.preventDefault(); if (tokenInput.trim()) saveToken(tokenInput.trim()); }}>
            <div className="flex gap-2">
              <input id="gh-token" className="field font-mono text-[12px]" placeholder="github_pat_…"
                value={tokenInput.trim()} onChange={e => setTokenInput(e.target.value)} />
              <button className="btn primary sm" disabled={busy === "token"}>Save</button>
            </div>
            <p className="text-[11px] text-ink-3 flex items-start gap-1">
              <Lock size={11} className="mt-0.5 flex-none" />
              A fine-grained token with Contents, Metadata and Pull requests set to <b>read-only</b>.
              {" "}<a className="text-accent" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create one</a>
            </p>
          </form>
        )}
      </div>

      {hasToken && (
        <div className="grid gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-medium text-ink-2">Repositories</span>
            <span className="text-[12px] text-ink-3 tnum">{on} of {repos.length} on</span>
            {repos.length > 8 && (
              <input className="field h-7 text-[12px] ml-auto w-[180px]" placeholder="Filter…"
                value={filter} onChange={e => setFilter(e.target.value)} />
            )}
          </div>

          {!repos.length ? (
            <p className="text-[11.5px] text-ink-3">No repositories found. Check the token has access to them.</p>
          ) : (
            <div className="bg-panel rounded-lg overflow-hidden max-h-[320px] overflow-y-auto">
              {shown.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-3 py-2 border-b border-line-2 last:border-0">
                  <label className="flex items-start gap-2 min-w-0 flex-1 cursor-pointer">
                    <input type="checkbox" checked={r.enabled} onChange={() => toggle(r)} className="mt-1 flex-none" />
                    <span className="min-w-0">
                      <span className={`block truncate text-[12.5px] ${r.enabled ? "" : "text-ink-3"}`}>
                        {r.full_name}
                        {r.private && <span className="pill text-ink-3 ml-1.5">private</span>}
                      </span>
                      <span className="block text-[11px] text-ink-3 truncate">
                        {r.index_error
                          ? <span className="text-warn">{r.index_error}</span>
                          : r.indexed_at
                            ? `${r.path_count} files · read ${formatDistanceToNow(new Date(r.indexed_at), { addSuffix: true })}`
                            : r.description || (r.language ?? "not read yet")}
                      </span>
                    </span>
                  </label>
                  {r.enabled && (
                    <button className="btn ghost sm px-2 flex-none" title="Read it again" disabled={busy === r.full_name}
                      onClick={() => index(r.full_name)}>
                      <RefreshCw size={12} className={busy === r.full_name ? "animate-spin" : ""} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-ink-3 flex items-start gap-1.5">
            <AlertTriangle size={11} className="mt-0.5 flex-none" />
            Only file names and the README are read — never your source code, and nothing is sent anywhere until you open a task and ask.
          </p>
        </div>
      )}
    </section>
  );
}
