import type { Metadata } from "next";
import { Legal, H2, P, UL } from "@/components/Legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms for using Tracker.",
};

export default function Terms() {
  return (
    <Legal title="Terms of Service" updated="11 September 2026">
      <P>
        Tracker is a personal task manager built and run by Amit Sourav. By signing in and
        using it, you agree to these terms.
      </P>

      <H2>What the service does</H2>
      <P>
        Tracker collects tasks from connected sources — currently Gmail, and WhatsApp
        groups the user enables through a bot they operate themselves — and presents them
        for review. Suggested tasks are added to the task list only when accepted by the
        user. The application can also draft messages for the user to send; it never sends
        messages, emails or replies on the user&apos;s behalf.
      </P>

      <H2>Accounts and access</H2>
      <UL items={[
        <>You are responsible for keeping access to your email account and to this
          application secure.</>,
        <>You may connect only accounts you own or are authorised to use.</>,
        <>You may disconnect any source, export your data, or stop using the service at
          any time from Settings.</>,
      ]} />

      <H2>Artificial intelligence</H2>
      <P>
        Task extraction and message drafting use large language models accessed through
        OpenRouter with the user&apos;s own API key and at the user&apos;s own cost, subject
        to the monthly spending limit set in Settings.
      </P>
      <P>
        Model output can be wrong. Extracted tasks, dates, priorities and drafted messages
        are suggestions and should be read before being relied on or sent. The user is
        responsible for anything they accept or send.
      </P>

      <H2>Acceptable use</H2>
      <UL items={[
        <>Do not use the service to access data you have no right to access.</>,
        <>Do not attempt to interfere with, overload or gain unauthorised access to the
          service or its infrastructure.</>,
      ]} />

      <H2>Availability</H2>
      <P>
        This is a personal project provided on an <b>as-is</b> basis, with no guarantee of
        uptime, correctness, or continued availability. Features may change or be removed.
        Connected third-party services — Google, Supabase, Vercel, OpenRouter, WhatsApp —
        may change or fail in ways outside this application&apos;s control.
      </P>

      <H2>Your data</H2>
      <P>
        Data handling is described in the <a href="/privacy">Privacy Policy</a>. You retain
        ownership of your own content, and can export it from Settings in open formats
        (JSON and CSV) at any time.
      </P>

      <H2>Liability</H2>
      <P>
        To the extent permitted by law, the operator is not liable for any loss arising
        from use of the service, including missed tasks, incorrect deadlines, messages sent
        on the basis of a drafted suggestion, or data loss. Keep your own records for
        anything important.
      </P>

      <H2>Termination</H2>
      <P>
        Access may be withdrawn at any time. You may stop using the service and delete your
        data whenever you wish.
      </P>

      <H2>Contact</H2>
      <P>
        Questions can be sent to{" "}
        <a href="mailto:amitsourav0407@gmail.com">amitsourav0407@gmail.com</a>.
      </P>
    </Legal>
  );
}
