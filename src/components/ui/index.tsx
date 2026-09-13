"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

/**
 * A menu anchored to its trigger, rendered at the top of the document.
 *
 * It used to be absolutely positioned inside the trigger's own box, which is
 * fine in a plain list and broken everywhere else: the table view puts each row
 * inside a horizontal scroller, and a scroll container clips its children in
 * both directions, so menus on the lower rows opened invisibly. A portal escapes
 * every ancestor's overflow, and fixed coordinates measured from the trigger
 * keep it attached.
 *
 * Placement flips above the trigger when there is not room below, and is nudged
 * back inside the viewport horizontally, so a menu is never off-screen.
 */
export function Popover({ trigger, children, align = "left", open: openProp, onOpenChange }: { trigger: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; open?: boolean; onOpenChange?: (v: boolean) => void }) {
  const [openState, setOpen] = useState(false);
  const open = openProp ?? openState;
  const set = (v: boolean) => { setOpen(v); onOpenChange?.(v); };
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) set(false);
    };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); set(false); } };
    // The menu is no longer a descendant of whatever is scrolling, so it has to
    // be told to go away when the page moves underneath it.
    const away = () => set(false);
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k, true);
    window.addEventListener("scroll", away, true); window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k, true);
      window.removeEventListener("scroll", away, true); window.removeEventListener("resize", away);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Measure after the menu exists but before the browser paints, so it never
  // appears in the wrong place first.
  useLayoutEffect(() => {
    if (!open || !ref.current) { setPos(null); return; }
    const t = ref.current.getBoundingClientRect();
    const m = menuRef.current?.getBoundingClientRect();
    const w = m?.width ?? 200, h = m?.height ?? 240;
    const below = window.innerHeight - t.bottom;
    const top = below < h + 8 && t.top > h + 8 ? t.top - h - 4 : t.bottom + 4;
    let left = align === "right" ? t.right - w : t.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    setPos({ top, left });
  }, [open, align, children]);

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={(e) => { e.stopPropagation(); set(!open); }}>{trigger}</div>
      {open && typeof document !== "undefined" && createPortal(
        <div ref={menuRef}
          className="fixed z-50 menu fade-in"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? "visible" : "hidden" }}
          onClick={e => e.stopPropagation()}>
          {children(() => set(false))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function Modal({ open, onClose, children, width = 560 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-[12vh] px-4" onMouseDown={onClose}>
      <div className="bg-panel border border-line rounded-xl w-full fade-in" style={{ maxWidth: width, boxShadow: "var(--shadow)" }} onMouseDown={e => e.stopPropagation()}>{children}</div>
    </div>
  );
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="inline-block rounded-full flex-none" style={{ width: size, height: size, background: color }} />;
}

export function PriorityFlag({ p, className }: { p: number; className?: string }) {
  const c = p === 1 ? "var(--p1)" : p === 2 ? "var(--p2)" : p === 3 ? "var(--p3)" : "var(--p4)";
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" className={clsx("flex-none", className)} aria-label={`Priority ${p}`}>
      <path d="M3 1.5v13" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3 2h9l-2.2 3.2L12 8.5H3z" fill={p === 4 ? "none" : c} stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function Avatar({ name, size = 18 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? "").join("");
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return <span className="inline-grid place-items-center rounded-full font-semibold flex-none text-white" style={{ width: size, height: size, fontSize: size * 0.48, background: `hsl(${h} 45% 45%)` }}>{initials}</span>;
}

export function Kbd({ k }: { k: string }) { return <kbd>{k}</kbd>; }
