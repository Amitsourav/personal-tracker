import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shell for the public policy pages.
 *
 * Deliberately plain and self-contained: these are reached by Google's reviewers
 * and by anyone signed out, so they must render without the app shell, without a
 * session, and without client-side JavaScript.
 */
export function Legal({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-bg text-ink">
      <div className="mx-auto max-w-[68ch] px-5 py-10">
        <header className="mb-8">
          <Link href="/" className="flex items-center gap-2 mb-6 no-underline">
            <span className="w-6 h-6 rounded-md bg-accent text-accent-ink grid place-items-center font-semibold text-[13px]">T</span>
            <span className="font-semibold text-[13.5px] text-ink">Tracker</span>
          </Link>
          <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
          <p className="text-[12.5px] text-ink-3 mt-1">Last updated {updated}</p>
        </header>
        <div className="text-[14px] leading-[1.65] text-ink-2 [&_a]:text-accent [&_a]:underline [&_b]:text-ink [&_b]:font-semibold">
          {children}
        </div>
        <footer className="mt-10 pt-5 border-t border-line text-[12.5px] text-ink-3 flex gap-4">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </footer>
      </div>
    </main>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="text-[16px] font-semibold text-ink mt-7 mb-2">{children}</h2>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mb-3">{children}</p>;
}

export function UL({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mb-3 grid gap-1.5 list-disc pl-5 marker:text-ink-3">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  );
}
