// The publishable key is safe to ship to browsers; row-level security protects
// the data.
//
// TODO (blocked on Vercel env vars): these fall back to the author's own
// Supabase project. The repo is public, so a fork that forgets the environment
// variables reads and writes someone else's database and looks like it is
// working. The guard that throws instead is written and ready — it cannot be
// turned on until NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
// are set in Vercel, because Next evaluates this at build time and the
// deployment fails without them.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://iljkjqlwrjkinvloqqgx.supabase.co";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_RWAqSb0Kjjo5xfYSoajQhQ_OuLT16nt";
