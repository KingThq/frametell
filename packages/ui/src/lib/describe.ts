// Tool calls in plain words. The runtimes report a tool name and a (possibly truncated) JSON summary of its arguments;
// a knowledge creator should read “Read “Pomodoro””, not {"path":"materials/pomodoro.md"}.
import { t, type MessageKey } from '../i18n';
import type zhRun from '../i18n/zh/run';

const pageNo = (id: string) => { const n = /p0*(\d+)/.exec(id); return n ? t('run.page', { n: n[1] }) : id; };
const pageN = (id: string) => /p0*(\d+)/.exec(id)?.[1] ?? id;
const base = (p: string) => p.split('/').pop()!.replace(/\.(md|markdown|txt)$/i, '');

/** what a tool call does, before it is put in words: one of the actions in i18n/<locale>/run.ts tool.* */
export type Act = { id: keyof typeof zhRun.tool; vars?: Record<string, string> };
/** acts on a page's code or an unnamed file: inside a page session these are all "drawing the page" */
export const PAGE_ACTS: Act['id'][] = ['readFile', 'writeFile', 'editFile', 'readPage', 'drawPage', 'editPage'];

function arg(summary: string, key: string): string | undefined {
  try { const v = JSON.parse(summary)[key]; if (typeof v === 'string') return v; } catch {}
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(summary);   // truncated JSON: take what is there
  return m ? m[1].replace(/\\"/g, '"').replace(/…$/, '') : undefined;
}

type Verb = 'read' | 'write' | 'edit';
const by = (verb: Verb, read: Act['id'], write: Act['id'], edit: Act['id']): Act['id'] => (verb === 'read' ? read : verb === 'write' ? write : edit);

function aboutPath(p: string, verb: Verb): Act {
  if (!p) return { id: by(verb, 'readFile', 'writeFile', 'editFile') };
  if (p.startsWith('materials/')) return { id: verb === 'read' ? 'readMaterial' : 'tidyMaterial', vars: { name: base(p) } };
  if (/(^|\/)storyboard\.json$/.test(p)) return { id: by(verb, 'readStoryboard', 'writeStoryboard', 'editStoryboard') };
  if (/(^|\/)script\.js$/.test(p)) return { id: by(verb, 'readScript', 'writeScript', 'editScript') };
  if (p === 'pages/p.js') return { id: verb === 'read' ? 'readPictures' : 'editPictures' };
  const page = /pages\/(p\d+)\.js$/.exec(p);
  if (page) return { id: by(verb, 'readPage', 'drawPage', 'editPage'), vars: { n: pageN(page[1]) } };
  if (/out\/snap\//.test(p)) return { id: 'readSnaps' };
  if (/revision\.json$/.test(p)) return { id: 'writePlan' };
  if (/^engine\//.test(p)) return { id: 'readEngine' };
  if (/voice\.js$/.test(p)) return { id: 'readVoice' };
  return { id: by(verb, 'readOther', 'writeOther', 'editOther'), vars: { file: p.split('/').pop()! } };
}

function aboutCommand(c: string): Act['id'] {
  if (/storyboard-lint/.test(c)) return 'checkStoryboard';
  if (/script\.mjs/.test(c)) return 'timeScript';
  if (/lint\.mjs/.test(c)) return 'checkLayout';
  if (/snap\.mjs/.test(c)) return 'snapshot';
  if (/use-extra/.test(c)) return 'loadComponents';
  if (/logos\.mjs/.test(c)) return 'prepareLogos';
  if (/pages\.mjs|times\.mjs/.test(c)) return 'readTimeline';
  if (/^\s*(ls|find|grep|rg|cat|sed|head|tail|wc)\b/.test(c)) return 'findFiles';
  return 'runCommand';
}

/** an edit whose path was cut off (older logs put the replaced text first): tell the file from the text it changes */
function guessPath(summary: string): string {
  const codex = /^(?:update|add|delete) (\S+)/.exec(summary);   // Codex: "update pages/p01.js"
  if (codex) return codex[1];
  if (/\\?"(say|object|action|beats|camera)\\?"\s*:/.test(summary)) return 'storyboard.json';
  if (/\bcues\b|section:|PAGES|META/.test(summary)) return 'script.js';
  if (/\bP\.\w+\(|\bs\(\\?'|Math\.|renderAt/.test(summary)) return 'pages/p.js';
  return '';
}

/** what one tool call does; undefined for a tool we have no words for */
export function toolAct(name: string, summary: string): Act | undefined {
  const n = name.toLowerCase();
  if (n === 'read') return aboutPath(arg(summary, 'path') || arg(summary, 'file_path') || '', 'read');
  if (n === 'write') return aboutPath(arg(summary, 'path') || arg(summary, 'file_path') || '', 'write');
  if (n === 'edit') return aboutPath(arg(summary, 'path') || arg(summary, 'file_path') || guessPath(summary), 'edit');
  if (n === 'bash') return { id: aboutCommand(arg(summary, 'command') || summary) };
  if (n === 'glob' || n === 'grep') return { id: 'findFiles' };
  return undefined;
}

/** an act in words. step: a finished step in the process list; start: the live line as it starts; doing: while it is being written */
export const actText = (a: Act, form: 'step' | 'start' | 'doing' = 'step') => t(`run.tool.${a.id}.${form}` as MessageKey, a.vars);

/** a short sentence for one tool call */
export function describeTool(name: string, summary: string, form: 'step' | 'start' | 'doing' = 'step'): string {
  const a = toolAct(name, summary);
  return a ? actText(a, form) : name;
}

/** collapse runs of the same description: “Read “A”, Wrote the storyboard, Checked the storyboard ×2” */
export function summarizeTools(calls: { name: string; summary: string }[]): { text: string; count: number }[] {
  const out: { text: string; count: number }[] = [];
  for (const c of calls) {
    const text = describeTool(c.name, c.summary);
    const last = out[out.length - 1];
    if (last && last.text === text) last.count++; else out.push({ text, count: 1 });
  }
  return out;
}

export const pageName = pageNo;

/** one step with its repeats, in words: “Revised the narration ×2” */
export const stepText = (s: { text: string; count: number }) => (s.count > 1 ? t('run.repeat', { text: s.text, n: s.count }) : s.text);
