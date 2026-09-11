"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Mail, MessageSquare, Sparkles } from "lucide-react";
import type { Task } from "@/lib/types";

type Meta = {
  reason?: string; due_raw?: string; kind?: string; model?: string;
  subject?: string; channel?: string; group?: string; to?: string;
};

/**
 * Why the system believes this task exists.
 *
 * The blueprint asks for "concise Why?, evidence, confidence and relevant
 * policy" while explicitly refusing to expose hidden chain-of-thought. So this
 * shows the evidence and the conclusion — the sentence someone actually wrote,
 * where it came from, what was read from it — and never a reasoning trace.
 *
 * Confidence is stated in words first. The blueprint is right that a bare
 * percentage is decorative: 0.95 tells you nothing about whether to check it,
 * "worth a glance" does.
 */
export function Why({ task, open: openProp }: { task: Task; open?: boolean }) {
  const [open, setOpen] = useState(!!openProp);
  const meta = (task.ai_meta ?? {}) as Meta;

  // Manual tasks have no belief to explain — Amit wrote them.
  if (task.source_kind === "manual" && !task.source_quote) return null;

  const c = task.confidence;
  const band = c == null ? null
    : c >= 0.8 ? { label: "Confident", tone: "text-ok" }
    : c >= 0.5 ? { label: "Fairly sure", tone: "text-ink-2" }
    : { label: "Worth a glance", tone: "text-warn" };

  const Channel = task.source_kind === "whatsapp" ? MessageSquare : Mail;
  const where = meta.group ?? meta.subject ?? (task.source_kind === "gmail" ? "an email" : "a message");

  return (
    <div className="rounded-lg bg-panel-2/60">
      <button
        className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left text-[11.5px] text-ink-3 hover:text-ink-2"
        onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={12} className="flex-none" /> : <ChevronRight size={12} className="flex-none" />}
        <Sparkles size={11} className="text-accent flex-none" />
        <span>Why this is here</span>
        {band && <span className={`ml-auto flex-none ${band.tone}`}>{band.label}</span>}
      </button>

      {open && (
        <div className="px-2.5 pb-2.5 pt-0.5 grid gap-2 text-[12px]">
          {/* The evidence: what was actually written. */}
          {task.source_quote && (
            <blockquote className="border-l-2 border-line pl-2.5 text-ink-2 italic leading-relaxed">
              “{task.source_quote}”
            </blockquote>
          )}

          {/* The conclusion, in the model's own words — a summary, not a trace. */}
          {meta.reason && <p className="text-ink-2 leading-relaxed">{meta.reason}</p>}

          <dl className="grid grid-cols-[86px_1fr] gap-x-3 gap-y-1 text-ink-3">
            <dt>Came from</dt>
            <dd className="text-ink-2 flex items-center gap-1.5 min-w-0">
              <Channel size={11} className="flex-none" />
              <span className="truncate">{where}</span>
              {task.source_link && (
                <a className="text-accent flex items-center gap-0.5 flex-none" href={task.source_link} target="_blank" rel="noreferrer">
                  open <ExternalLink size={9} />
                </a>
              )}
            </dd>

            {meta.due_raw && <>
              <dt>Deadline read</dt>
              <dd className="text-ink-2">from “{meta.due_raw}”</dd>
            </>}

            {meta.kind && <>
              <dt>Read as</dt>
              <dd className="text-ink-2">
                {meta.kind === "promise" ? "a promise you made"
                  : meta.kind === "commitment" ? "something they promised you"
                  : "something you were asked to do"}
              </dd>
            </>}

            {c != null && <>
              <dt>Confidence</dt>
              <dd className={band!.tone}>{band!.label} <span className="text-ink-3 tnum">· {Math.round(c * 100)}%</span></dd>
            </>}

            {meta.model && <>
              <dt>Read by</dt>
              <dd className="text-ink-3">{meta.model}</dd>
            </>}
          </dl>

          <p className="text-[11px] text-ink-3">
            Nothing here was added without you accepting it. If this is wrong, rejecting it teaches the filter.
          </p>
        </div>
      )}
    </div>
  );
}
