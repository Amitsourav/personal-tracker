// A thin GitHub client. Read-only by construction: nothing here issues a POST,
// PATCH or DELETE to github.com, so a mistake cannot change Amit's code.
const API = "https://api.github.com";

export type Repo = {
  full_name: string; default_branch: string; description: string | null;
  language: string | null; private: boolean; pushed_at: string | null;
};

async function gh<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "personal-tracker",
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`GitHub ${r.status}: ${body.slice(0, 200) || r.statusText}`);
  }
  return r.json() as Promise<T>;
}

export async function whoami(token: string) {
  return gh<{ login: string }>(token, "/user");
}

/** Repositories the token can see, most recently pushed first. */
export async function listRepos(token: string): Promise<Repo[]> {
  const out: Repo[] = [];
  for (let page = 1; page <= 4; page++) {
    const batch = await gh<Repo[]>(token, `/user/repos?per_page=100&sort=pushed&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

// Files that tell you nothing about where a feature lives, and would otherwise
// drown the list: lockfiles, build output, vendored dependencies, binaries.
const SKIP = /(^|\/)(node_modules|\.git|dist|build|out|coverage|vendor|\.next|target|__pycache__|\.venv)\//i;
const SKIP_FILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Gemfile\.lock|\.(png|jpe?g|gif|svg|ico|webp|mp4|mp3|pdf|zip|gz|woff2?|ttf|eot|map|min\.js|min\.css)$)/i;
const MAX_PATHS = 3000;

/**
 * Every source path in the repository, in one request.
 *
 * Paths only — no file contents leave GitHub. A model can reason about
 * structure from names alone surprisingly well, and it keeps the blast radius
 * of this feature to "it knows your folders are called what they are called".
 */
export async function repoTree(token: string, fullName: string, branch: string) {
  const tree = await gh<{ tree: { path: string; type: string }[]; truncated: boolean }>(
    token, `/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  const paths = (tree.tree ?? [])
    .filter(n => n.type === "blob" && !SKIP.test(n.path) && !SKIP_FILE.test(n.path))
    .map(n => n.path);
  return { paths: paths.slice(0, MAX_PATHS), truncated: tree.truncated || paths.length > MAX_PATHS };
}

/** The README, which is usually the only plain-English description of a repo. */
export async function readme(token: string, fullName: string): Promise<string | null> {
  try {
    const r = await gh<{ content: string; encoding: string }>(token, `/repos/${fullName}/readme`);
    if (r.encoding !== "base64") return null;
    return atob(r.content.replace(/\n/g, "")).slice(0, 4000);
  } catch { return null; }
}

export type Commit = { message: string; author: string | null; at: string | null };

/**
 * The recent history of one file, newest first.
 *
 * Several, not one. Asking only for the latest commit means a fix stops counting
 * as evidence the moment anyone touches the file again — which is backwards,
 * because the files that matter are the ones worked in most. The loan-amount fix
 * was invisible within three days for exactly this reason.
 */
export async function fileCommits(token: string, fullName: string, path: string, n = 5): Promise<Commit[]> {
  try {
    const c = await gh<{ commit: { message: string; author: { name: string; date: string } } }[]>(
      token, `/repos/${fullName}/commits?path=${encodeURIComponent(path)}&per_page=${n}`,
    );
    return (c ?? []).map(x => ({
      message: x.commit.message.split("\n")[0].slice(0, 120),
      author: x.commit.author?.name ?? null,
      at: x.commit.author?.date ?? null,
    }));
  } catch { return []; }
}

/** One file's text, at the default branch. */
export async function fileText(token: string, fullName: string, path: string): Promise<string | null> {
  try {
    const f = await gh<{ content?: string; encoding?: string; size: number }>(
      token, `/repos/${fullName}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
    );
    if (!f.content || f.encoding !== "base64" || f.size > 400_000) return null;
    return atob(f.content.replace(/\n/g, ""));
  } catch { return null; }
}

/**
 * The names a file defines that other files could be calling.
 *
 * Extracted with regexes rather than a model, deliberately. It is exact where a
 * model would be approximate, it costs nothing, and — the reason that matters —
 * it means "what else breaks" does not require shipping anyone's source code to
 * a model provider. The rest of this feature already promises that.
 */
export function definedSymbols(path: string, text: string): string[] {
  const out = new Set<string>();
  const add = (n?: string) => { if (n && n.length > 2 && !RESERVED.has(n)) out.add(n); };

  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) {
    for (const m of text.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
    for (const m of text.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
    for (const m of text.matchAll(/export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
    for (const m of text.matchAll(/export\s+(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
    for (const m of text.matchAll(/export\s*\{([^}]+)\}/g)) {
      for (const part of m[1].split(",")) add(part.split(/\s+as\s+/)[0].trim());
    }
  } else if (/\.py$/i.test(path)) {
    // Leading-underscore names are private by convention; skip them.
    for (const m of text.matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z][\w]*)/gm)) add(m[1]);
    for (const m of text.matchAll(/^\s*class\s+([A-Za-z][\w]*)/gm)) add(m[1]);
  } else if (/\.(go|rb|php|java|kt|rs)$/i.test(path)) {
    for (const m of text.matchAll(/^\s*(?:public\s+|pub\s+)?(?:func|def|function|fn)\s+([A-Za-z_][\w]*)/gm)) add(m[1]);
    for (const m of text.matchAll(/^\s*(?:public\s+)?class\s+([A-Za-z_][\w]*)/gm)) add(m[1]);
  }
  return [...out];
}

const RESERVED = new Set([
  "default", "main", "index", "app", "page", "layout", "route", "config", "props",
  "get", "post", "put", "patch", "delete", "handler", "init", "setup", "run", "test",
  "GET", "POST", "PUT", "PATCH", "DELETE", "metadata", "generateMetadata",
]);

export type Reference = { path: string; hits: number };

/**
 * Which other files in the repository mention a name.
 *
 * GitHub's code search, which is exact and free, rather than reasoning about it.
 * Search is rate-limited hard, so callers must keep the number of terms small.
 */
export async function findReferences(token: string, fullName: string, symbol: string): Promise<Reference[]> {
  try {
    const r = await gh<{ items: { path: string }[]; total_count: number }>(
      token, `/search/code?q=${encodeURIComponent(`"${symbol}" repo:${fullName}`)}&per_page=20`,
    );
    const counts = new Map<string, number>();
    for (const it of r.items ?? []) counts.set(it.path, (counts.get(it.path) ?? 0) + 1);
    return [...counts].map(([path, hits]) => ({ path, hits }));
  } catch { return []; }
}
