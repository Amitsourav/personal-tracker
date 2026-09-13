// The publishable key is safe to ship to browsers; row-level security protects
// the data.
//
// These used to fall back to the author's own Supabase project when unset. The
// repo is public, so a fork that forgot the environment variables would quietly
// read and write someone else's database and look like it was working. Failing
// loudly on a missing variable is the only honest behaviour: a silent wrong
// answer is worse than a crash that names the problem.
//
// Next evaluates this at build time, so a deployment without these variables
// fails rather than shipping. That is the point.
function required(name: string, value: string | undefined): string {
  if (value && value.trim()) return value;
  throw new Error(
    `${name} is not set.\n\n` +
    `Copy .env.example to .env.local and fill in your own Supabase project's ` +
    `URL and publishable key (Supabase → Project Settings → API). On Vercel, ` +
    `add them under Settings → Environment Variables.`,
  );
}

export const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_KEY = required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
