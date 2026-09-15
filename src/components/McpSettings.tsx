"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { SUPABASE_URL } from "@/lib/supabase/env";
import { Plug, Copy, Check, Eye, EyeOff, RefreshCw } from "lucide-react";

/**
 * Let Cursor and Claude Code ask the tracker questions.
 *
 * The re-explain loop is the well-documented gap: every AI tool keeps its
 * context inside its own app, so the same project is described again to each
 * one. The tracker holds what none of them can know — what the client actually
 * asked for, in their words, and which of it is still outstanding.
 *
 * Shown with the config ready to paste, because a protocol nobody can configure
 * is a protocol nobody uses.
 */
export function McpSettings() {
  const { toast } = useStore();
  const sb = createClient();
  const [row, setRow] = useState<{ mcp_token: string | null; mcp_enabled: boolean } | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [client, setClient] = useState<"claude-code" | "cursor">("claude-code");

  const load = useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    setUid(user.id);
    const { data } = await sb.from("user_secrets").select("mcp_token,mcp_enabled").maybeSingle();
    setRow(data ?? { mcp_token: null, mcp_enabled: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  if (!row) return null;

  const url = `${SUPABASE_URL}/functions/v1/mcp`;
  const tok = row.mcp_token ?? "";

  const copy = async (what: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 2000); }
    catch { toast("Could not copy"); }
  };

  const cmd = `claude mcp add --transport http tracker ${url} --header "Authorization: Bearer ${tok}"`;
  const cursorJson = JSON.stringify(
    { mcpServers: { tracker: { url, headers: { Authorization: `Bearer ${tok}` } } } },
    null, 2,
  );

  const rotate = async () => {
    if (!confirm("Create a new token?\n\nEvery editor configured with the old one stops working until you paste the new one in.")) return;
    const t = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const { error } = await sb.from("user_secrets").update({ mcp_token: t }).eq("user_id", uid!);
    if (error) return toast("Failed: " + error.message);
    setRow(r => r ? { ...r, mcp_token: t } : r);
    setShow(true);
    toast("New token — update your editors");
  };

  return (
    <section className="bg-panel-2 rounded-xl p-5 grid gap-3.5">
      <div>
        <h2 className="font-semibold text-[13px] flex items-center gap-1.5"><Plug size={13} /> Your editor</h2>
        <p className="text-[11.5px] text-ink-3 mt-0.5">
          Let Claude Code or Cursor ask the tracker what a client actually asked for, without you leaving the editor.
        </p>
      </div>

      <label className="flex items-center gap-2 text-[12.5px] cursor-pointer">
        <input type="checkbox" checked={row.mcp_enabled}
          onChange={async e => {
            const on = e.target.checked;
            setRow(r => r ? { ...r, mcp_enabled: on } : r);
            await sb.from("user_secrets").update({ mcp_enabled: on }).eq("user_id", uid!);
            toast(on ? "Editors can connect" : "Disconnected");
          }} />
        <span>Allow editors to connect</span>
        {!row.mcp_enabled && <span className="pill bg-p1-soft text-p1">Off</span>}
      </label>

      {row.mcp_enabled && (
        <>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(["claude-code", "cursor"] as const).map(c => (
              <button key={c} className={`btn sm ${client === c ? "primary" : ""}`} onClick={() => setClient(c)}>
                {c === "claude-code" ? "Claude Code" : "Cursor"}
              </button>
            ))}
            <button className="btn ghost sm px-2 ml-auto" onClick={() => setShow(v => !v)} title={show ? "Hide the token" : "Show the token"}>
              {show ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
            <button className="btn ghost sm px-2 text-warn" onClick={rotate} title="New token">
              <RefreshCw size={12} />
            </button>
          </div>

          {client === "claude-code" ? (
            <div className="grid gap-1.5">
              <p className="text-[11.5px] text-ink-2">Run this once in your terminal:</p>
              <pre className="bg-panel rounded-lg p-2.5 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {show ? cmd : cmd.replace(tok, "•".repeat(12))}
              </pre>
              <button className="btn sm justify-self-start" onClick={() => copy("cmd", cmd)}>
                {copied === "cmd" ? <Check size={12} className="text-ok" /> : <Copy size={12} />} Copy command
              </button>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <p className="text-[11.5px] text-ink-2">
                Add this to <code className="font-mono">~/.cursor/mcp.json</code>:
              </p>
              <pre className="bg-panel rounded-lg p-2.5 text-[11px] font-mono overflow-x-auto">
                {show ? cursorJson : cursorJson.replace(tok, "•".repeat(12))}
              </pre>
              <button className="btn sm justify-self-start" onClick={() => copy("json", cursorJson)}>
                {copied === "json" ? <Check size={12} className="text-ok" /> : <Copy size={12} />} Copy config
              </button>
            </div>
          )}

          <div className="text-[11.5px] text-ink-3 grid gap-1">
            <div className="text-ink-2 font-medium">Then, in your editor, you can ask:</div>
            <div>· “what did Deepak actually ask for on the invoice search?”</div>
            <div>· “what&rsquo;s still open in this repo?”</div>
            <div>· “add a task: check the disbursement join”</div>
          </div>

          <p className="text-[11px] text-ink-3">
            It can read your tasks and the messages behind them, and add a task. It cannot complete,
            edit or delete anything — nothing your editor does by accident can destroy work.
          </p>
        </>
      )}
    </section>
  );
}
