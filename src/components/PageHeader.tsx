"use client";
import type { ReactNode } from "react";

/**
 * The one page header.
 *
 * Every page used to build its own, so title size, padding and the position of
 * actions drifted apart — and navigating between pages made the header visibly
 * jump. Carbon names this directly: a shared header exists "to avoid users
 * experiencing jarring movement and jumping of headers when navigating among
 * product content". One component, one height, one position for everything.
 *
 *   title   — what this page is
 *   count   — how many things are on it, in tabular figures
 *   hint    — a quiet clause of context, hidden on narrow screens
 *   left    — controls that belong to the subject (a date picker, a filter)
 *   actions — what you can do here, always flush right
 */
export function PageHeader({ title, count, hint, left, actions }: {
  title: string;
  count?: number;
  hint?: string;
  left?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-2.5 px-5 h-14 border-b border-line flex-none">
      <h1 className="font-semibold text-[15px] tracking-[-0.02em] truncate">{title}</h1>
      {count !== undefined && (
        <span className="text-[12px] text-ink-3 tnum flex-none">{count}</span>
      )}
      {left}
      {hint && (
        <span className="text-[12px] text-ink-3 truncate hidden lg:inline">{hint}</span>
      )}
      {actions && <div className="ml-auto flex items-center gap-1.5 flex-none">{actions}</div>}
    </header>
  );
}

/**
 * The one measure: 980px, Apple's own maximum for text-heavy surfaces.
 *
 * Pages previously ran at 640, 720, 760, 820, 980 and full-bleed, so content
 * changed width on every navigation. A single measure is most of what makes an
 * app feel like one product rather than nine pages.
 */
export function PageBody({ children, wide, className = "" }: {
  children: ReactNode;
  /** Tables and boards earn the full width; reading surfaces do not. */
  wide?: boolean;
  className?: string;
}) {
  return (
    <div className="flex-1 overflow-auto">
      <div className={`${wide ? "" : "max-w-[980px]"} px-5 py-5 ${className}`}>
        {children}
      </div>
    </div>
  );
}
