"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/auth/callback` } });
    setBusy(false);
    if (error) setErr(error.message); else setSent(true);
  }
  async function google() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback` } });
  }

  return (
    <main className="min-h-dvh grid place-items-center px-5">
      <div className="w-full max-w-[360px] bg-panel border border-line rounded-xl p-7" style={{ boxShadow: "var(--shadow)" }}>
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-8 h-8 rounded-lg bg-accent text-accent-ink grid place-items-center font-semibold text-base">T</div>
          <div><div className="font-semibold text-[15px] leading-tight">Tracker</div><div className="text-ink-3 text-[12px]">Your tasks, from the people who give you work</div></div>
        </div>
        {sent ? (
          <div className="text-[13px]">
            <div className="font-medium mb-1">Check your email</div>
            <div className="text-ink-2">We sent a sign-in link to <b>{email}</b>. Open it on this device.</div>
            <button className="btn ghost mt-4" onClick={() => setSent(false)}>Use a different email</button>
          </div>
        ) : (
          <form onSubmit={sendLink} className="grid gap-3">
            <label className="grid gap-1 text-[12px] text-ink-2">Email
              <input id="email" className="field" type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="you@gmail.com" />
            </label>
            {err && <div className="text-danger text-[12px]">{err}</div>}
            <button className="btn primary justify-center h-9" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
            <div className="flex items-center gap-3 text-ink-3 text-[11px] my-1"><span className="h-px bg-line flex-1" />or<span className="h-px bg-line flex-1" /></div>
            <button type="button" className="btn justify-center h-9" onClick={google}>
              <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.5 42.6 14.6 48 24 48z"/></svg>
              Continue with Google
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
