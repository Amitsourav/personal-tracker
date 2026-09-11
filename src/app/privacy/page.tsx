import type { Metadata } from "next";
import { Legal, H2, P, UL } from "@/components/Legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Tracker handles your data, including data from Google.",
};

// Required by Google before an OAuth app using restricted scopes (gmail.readonly)
// can be published. It must describe, accurately, what Google user data the app
// accesses, why, where it is stored, who it is shared with, and how to revoke.
export default function Privacy() {
  return (
    <Legal title="Privacy Policy" updated="11 September 2026">
      <P>
        Tracker is a personal task manager built and run by Amit Sourav for his own use.
        It reads his email and messages so that tasks other people give him are collected
        automatically instead of being remembered by hand.
      </P>
      <P>
        This policy describes exactly what the application does with data, including data
        obtained through Google APIs.
      </P>

      <H2>Who this applies to</H2>
      <P>
        Tracker is a single-user application. Each person who signs in has their own
        isolated account and can only ever see their own data. There is no shared or
        public area, no advertising, and no analytics tracking of any kind.
      </P>

      <H2>What data is accessed</H2>
      <UL items={[
        <><b>Google account email address</b> — to identify which mailbox is connected.</>,
        <><b>Gmail messages (read-only)</b> — subject, sender, recipient, date and body text
          of messages in the inbox and in Sent mail, so that requests made of the user and
          commitments made by the user can be identified.</>,
        <><b>Google Calendar</b> — access is requested for planned scheduling features.
          Calendar data is not currently read, written or stored.</>,
        <><b>WhatsApp messages</b> — only from group chats the user has explicitly enabled,
          via a bot the user operates themselves. All other chats are never read.</>,
        <><b>Tasks, projects, people and notes</b> that the user creates in the application.</>,
      ]} />

      <H2>How that data is used</H2>
      <P>
        Message text is used for one purpose: to identify action items. Messages are first
        filtered locally — newsletters, promotional mail, automated notifications and
        messages from senders the user has chosen to ignore are discarded without being
        read further.
      </P>
      <P>
        Remaining messages are sent to a large language model through OpenRouter, using the
        user&apos;s own API key, which returns any tasks it finds. Those tasks appear in a
        review inbox and are added to the task list only when the user accepts them.
      </P>
      <P>
        Before any text is sent to a model, one-time passwords, verification codes, long
        digit sequences such as account and card numbers, and bank IFSC codes are replaced
        with placeholders.
      </P>
      <P>
        Google user data is <b>never</b> used to train, retrain or improve any machine
        learning or artificial intelligence model, and is never used for advertising.
      </P>

      <H2>Where data is stored</H2>
      <UL items={[
        <>All data is stored in the user&apos;s own Supabase (PostgreSQL) database, protected
          by row-level security so that a signed-in user can only read their own rows.</>,
        <>Message bodies are retained for <b>30 days</b> and then automatically deleted by a
          scheduled job. Subjects, senders and the resulting tasks are kept until the user
          deletes them.</>,
        <>Google refresh tokens and API keys are stored in that same database and are
          readable only by the account that owns them.</>,
        <>The application is hosted on Vercel; the database is hosted by Supabase.</>,
      ]} />

      <H2>Who data is shared with</H2>
      <P>
        Tracker does not sell data, does not share it with advertisers, and does not
        transfer it to anyone for any purpose unrelated to the features described here.
        Data is processed only by the infrastructure the application runs on:
      </P>
      <UL items={[
        <><b>Supabase</b> — database and authentication.</>,
        <><b>Vercel</b> — application hosting.</>,
        <><b>OpenRouter</b> and the model provider selected by the user — receives the
          redacted text of messages that pass filtering, in order to extract tasks.</>,
        <><b>Google</b> — as the source of the mail being read.</>,
      ]} />
      <P>
        Tracker&apos;s use of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Google API Services User Data Policy
        </a>, including the Limited Use requirements.
      </P>

      <H2>Withdrawing access</H2>
      <P>
        Google access can be revoked at any time, either by clicking <b>Disconnect</b> in
        the application&apos;s Settings, or from{" "}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
          your Google account permissions page
        </a>. Once revoked, the application can no longer read mail. Stored data can be
        exported or deleted from Settings at any time.
      </P>

      <H2>Security</H2>
      <P>
        Access requires a signed-in session. All traffic is served over HTTPS. Database
        access is restricted per user by row-level security policies. No third party is
        given access to the database.
      </P>

      <H2>Children</H2>
      <P>Tracker is not intended for use by anyone under 16.</P>

      <H2>Changes</H2>
      <P>
        If this policy changes, the date at the top of this page will be updated.
      </P>

      <H2>Contact</H2>
      <P>
        Questions about this policy can be sent to{" "}
        <a href="mailto:amitsourav0407@gmail.com">amitsourav0407@gmail.com</a>.
      </P>
    </Legal>
  );
}
