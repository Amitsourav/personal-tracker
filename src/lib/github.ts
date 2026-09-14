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

/** Who last touched a file, and when — the context that turns a path into a lead. */
export async function lastCommit(token: string, fullName: string, path: string) {
  try {
    const c = await gh<{ commit: { message: string; author: { name: string; date: string } } }[]>(
      token, `/repos/${fullName}/commits?path=${encodeURIComponent(path)}&per_page=1`,
    );
    const top = c?.[0];
    if (!top) return null;
    return {
      message: top.commit.message.split("\n")[0].slice(0, 120),
      author: top.commit.author?.name ?? null,
      at: top.commit.author?.date ?? null,
    };
  } catch { return null; }
}
