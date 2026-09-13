"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Copy, Check, Eye, EyeOff, RefreshCw, AlertTriangle } from "lucide-react";

type Group = { id: string; wa_group_id: string; name: string | null; enabled: boolean; last_message_at: string | null };
type Secrets = { whatsapp_token: string | null; whatsapp_owner_phone: string | null; whatsapp_enabled: boolean };

/**
 * WhatsApp capture, without the SQL editor.
 *
 * Every switch here existed already — `whatsapp_groups.enabled`, the endpoint
 * token, the master `whatsapp_enabled` — but the only way to reach them was a
 * hand-written UPDATE. A kill switch you cannot find in a hurry is not a kill
 * switch, which is the whole reason this screen exists.
 *
 * Groups are never created here. They appear the first time the bot forwards
 * something from them, so this list is a record of what is actually happening
 * rather than what someone once intended.
 */
export function WhatsAppSettings() {
  const { toast } = useStore();
  const sb = createClient();
  const [uid, setUid] = useState<string | null>(null);
  const [s, setS] = useState<Secrets | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    setUid(user.id);
    const [{ data: sec }, { data: g }] = await Promise.all([
      sb.from("user_secrets").select("whatsapp_token,whatsapp_owner_phone,whatsapp_enabled").eq("user_id", user.id).maybeSingle(),
      sb.from("whatsapp_groups").select("id,wa_group_id,name,enabled,last_message_at")
        .eq("user_id", user.id).order("last_message_at", { ascending: false, nullsFirst: false }),
    ]);
    setS((sec ?? { whatsapp_token: null, whatsapp_owner_phone: null, whatsapp_enabled: true }) as Secrets);
    setGroups((g ?? []) as Group[]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  if (!s || groups === null) return null;

  const save = async (patch: Partial<Secrets>) => {
    setS(x => x ? { ...x, ...patch } : x);
    const { error } = await sb.from("user_secrets").update(patch).eq("user_id", uid!);
    if (error) { toast("Save failed: " + error.message); load(); } else toast("Saved");
  };

  const toggleGroup = async (g: Group) => {
    setGroups(gs => (gs ?? []).map(x => x.id === g.id ? { ...x, enabled: !x.enabled } : x));
    const { error } = await sb.from("whatsapp_groups").update({ enabled: !g.enabled }).eq("id", g.id);
    if (error) { toast("Save failed: " + error.message); load(); }
    else toast(!g.enabled ? "Capturing from this group" : "Stopped capturing from this group");
  };

  const copyToken = async () => {
    if (!s.whatsapp_token) return;
    try {
      await navigator.clipboard.writeText(s.whatsapp_token);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { toast("Could not copy — reveal it and copy by hand"); }
  };

  // Rotating breaks capture until the bot is given the new token, so it asks
  // first and says plainly what will stop.
  const rotate = async () => {
    if (!confirm("Create a new token?\n\nWhatsApp capture STOPS until you give the new token to the bot team. Anyone holding the old one loses access immediately.")) return;
    setRotating(true);
    const tok = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const { error } = await sb.from("user_secrets").update({ whatsapp_token: tok }).eq("user_id", uid!);
    setRotating(false);
    if (error) return toast("Failed: " + error.message);
    setS(x => x ? { ...x, whatsapp_token: tok } : x);
    setShowToken(true);
    toast("New token created — send it to the bot team now");
  };

  const mask = (t: string) => t.slice(0, 6) + "…" + t.slice(-4);
  const live = groups.filter(g => g.enabled).length;

  return (
    <section className="bg-panel-2 rounded-xl p-5 grid gap-3.5">
      <div>
        <h2 className="font-semibold text-[13px] flex items-center gap-1.5">
          <MessageSquare size={13} className="text-ok" /> WhatsApp
        </h2>
        <p className="text-[11.5px] text-ink-3 mt-0.5">
          Tasks captured from group messages by your bot. Groups appear here the first time the bot forwards from them.
        </p>
      </div>

      {/* Master switch. Off means the endpoint rejects everything, whatever the
          bot is configured to do — one place to stop it all. */}
      <label className="flex items-center gap-2 text-[12.5px] cursor-pointer">
        <input type="checkbox" checked={s.whatsapp_enabled}
          onChange={e => save({ whatsapp_enabled: e.target.checked })} />
        <span>Accept messages from the bot</span>
        {!s.whatsapp_enabled && <span className="pill bg-p1-soft text-p1">Capture is off</span>}
      </label>

      <div className="grid grid-cols-[130px_1fr] items-center gap-2 text-[12.5px]">
        <span className="text-ink-2">Your number</span>
        <input className="field" placeholder="+9170044…" defaultValue={s.whatsapp_owner_phone ?? ""}
          onBlur={e => e.target.value !== (s.whatsapp_owner_phone ?? "") && save({ whatsapp_owner_phone: e.target.value || null })} />
      </div>

      <div className="grid grid-cols-[130px_1fr] items-start gap-2 text-[12.5px]">
        <span className="text-ink-2 pt-1.5">Bot token</span>
        <div className="grid gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <code className="text-[12px] text-ink-2 font-mono truncate">
              {s.whatsapp_token ? (showToken ? s.whatsapp_token : mask(s.whatsapp_token)) : "none"}
            </code>
            {s.whatsapp_token && <>
              <button className="btn ghost sm px-2" onClick={() => setShowToken(v => !v)} title={showToken ? "Hide" : "Reveal"}>
                {showToken ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button className="btn ghost sm px-2" onClick={copyToken} title="Copy">
                {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
              </button>
              <button className="btn ghost sm px-2 text-warn" onClick={rotate} disabled={rotating} title="Create a new token">
                <RefreshCw size={12} className={rotating ? "animate-spin" : ""} />
              </button>
            </>}
          </div>
          <p className="text-[11px] text-ink-3">
            The bot sends this on every message to prove it is yours. Treat it like a password.
          </p>
        </div>
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center gap-2 text-[12px] text-ink-2">
          <span className="font-medium">Groups</span>
          <span className="text-ink-3 tnum">{live} of {groups.length} on</span>
        </div>

        {!groups.length ? (
          <p className="text-[11.5px] text-ink-3">
            No groups yet. Once the bot forwards a message from a group, it appears here and you can switch it off.
          </p>
        ) : (
          <div className="bg-panel rounded-lg overflow-hidden">
            {groups.map(g => (
              <div key={g.id} className="flex items-center gap-3 px-3 py-2 border-b border-line-2 last:border-0">
                <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                  <input type="checkbox" checked={g.enabled} onChange={() => toggleGroup(g)} className="flex-none" />
                  <span className="min-w-0">
                    <span className={`block truncate text-[12.5px] ${g.enabled ? "" : "text-ink-3"}`}>
                      {/* The bot does not always send a name; the raw id is at
                          least honest about which group it is. */}
                      {g.name && g.name !== g.wa_group_id ? g.name : <span className="font-mono text-[11.5px]">{g.wa_group_id}</span>}
                    </span>
                    <span className="block text-[11px] text-ink-3">
                      {g.last_message_at
                        ? `last message ${formatDistanceToNow(new Date(g.last_message_at), { addSuffix: true })}`
                        : "nothing received yet"}
                    </span>
                  </span>
                </label>
                {!g.enabled && <span className="pill text-ink-3 flex-none">Off</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {!s.whatsapp_owner_phone && (
        <p className="text-[11.5px] text-warn flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 flex-none" />
          Add your number so the bot can tell which messages are yours — without it, promises you make in a group are not captured.
        </p>
      )}
    </section>
  );
}
