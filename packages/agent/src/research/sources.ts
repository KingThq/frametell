// What a request points at: web pages, code repositories, and (on the user's own machine) folders and files. Found in
// the words the user typed; a repository is read from a shallow clone, a local folder in place, never copied.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitClone } from '../git.js';

export interface Sources {
  /** web pages to read (repository links are in `repos` instead) */
  urls: string[];
  /** code repositories by their web address, e.g. https://github.com/owner/name */
  repos: { url: string; host: string; owner: string; name: string; /** a folder inside it the link pointed at */ sub?: string }[];
  /** folders and files on this machine, absolute */
  local: string[];
}

const URL_RE = /https?:\/\/[^\s<>"'`，。；、！？）】」』]+/g;
const REPO_RE = /^https?:\/\/(github\.com|gitlab\.com|gitee\.com|codeberg\.org)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/[^/]+\/?(.*))?\/?$/;
// a path starts at /, ~/ or a drive letter; it may be quoted (to hold spaces) or run to the next space
const PATH_RE = /["“'`](~?\/[^"”'`\n]+|[A-Za-z]:\\[^"”'`\n]+)["”'`]|(?:^|[\s(（:：])(~\/[^\s，。；、！？）)]*|\/(?:Users|home|mnt|Volumes|opt|srv|data|tmp|var|workspace|code|projects?)\/[^\s，。；、！？）)]*|[A-Za-z]:\\[^\s，。；、！？）)]*)/g;

const trimEnd = (s: string) => s.replace(/[.,;:!?)\]}>'"]+$/, '');

/**
 * The pages, repositories and (when `local`) folders or files the text points at. A local path counts only when it
 * exists; on a hosted service `local` is off, so nothing on the server is ever read.
 */
export function findSources(text: string, o: { local: boolean }): Sources {
  const out: Sources = { urls: [], repos: [], local: [] };
  for (const m of text.matchAll(URL_RE)) {
    const url = trimEnd(m[0]);
    const r = REPO_RE.exec(url);
    if (r && !['orgs', 'topics', 'search', 'settings', 'marketplace', 'features'].includes(r[2])) {
      if (!out.repos.some((x) => x.host === r[1] && x.owner === r[2] && x.name === r[3])) out.repos.push({ url: `https://${r[1]}/${r[2]}/${r[3]}`, host: r[1], owner: r[2], name: r[3], sub: r[4] || undefined });
    } else if (!out.urls.includes(url)) out.urls.push(url);
  }
  if (o.local) {
    const bare = text.replace(URL_RE, ' ');
    for (const m of bare.matchAll(PATH_RE)) {
      const raw = trimEnd((m[1] ?? m[2]).trim());
      const abs = path.resolve(raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw);
      if (abs !== path.parse(abs).root && fs.existsSync(abs) && !out.local.includes(abs)) out.local.push(abs);
    }
  }
  return out;
}

export const hasSources = (s: Sources) => s.urls.length + s.repos.length + s.local.length > 0;

/** a shallow clone of the repository into `dest` (kept: a run that continues reads it again); file blobs over 2 MB stay behind */
export async function cloneRepo(repo: Sources['repos'][number], dest: string, signal?: AbortSignal): Promise<string> {
  if (fs.existsSync(path.join(dest, '.git'))) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  await gitClone(`${repo.url}.git`, dest, signal);
  return dest;
}
