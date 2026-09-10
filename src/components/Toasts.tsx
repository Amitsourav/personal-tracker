"use client";
import { useStore } from "@/lib/store";
export function Toasts() {
  const toasts = useStore(s => s.toasts);
  const dismiss = useStore(s => s.dismissToast);
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] grid gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-3 bg-ink text-bg px-3.5 h-9 rounded-lg text-[12.5px] fade-in" style={{ boxShadow: "var(--shadow)" }}>
          <span>{t.text}</span>
          {t.undo && <button className="font-semibold underline underline-offset-2" onClick={() => { t.undo?.(); dismiss(t.id); }}>Undo</button>}
        </div>
      ))}
    </div>
  );
}
