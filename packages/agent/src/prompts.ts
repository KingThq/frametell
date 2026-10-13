// System prompts for each stage, assembled from prompts/*.md and the chosen style's grammar card, and the per-stage
// user messages. Stable text first (system), changing text last (user), so provider prompt caches stay warm.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';
import type { PageTiming, Storyboard, LintIssue } from './project.js';

import { pagePack } from './pagepack.js';

// found through the package itself, so it still resolves when the code is bundled (the desktop app)
const DIR = path.join(path.dirname(createRequire(import.meta.url).resolve('@frametell/agent/package.json')), 'prompts');
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
const grammar = (style: string) => {
  const f = path.join(ENGINE_DIR, 'styles', style, 'GRAMMAR.md');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : `Style: ${style}`;
};

/** fallback names; the panel shows its own translated names for these ids */
export const STYLES: { id: string; name: string; summary: string }[] = [
  { id: 'warm-story', name: 'Warm illustration', summary: 'Warm flat illustration with one metaphor object carried through the film; for investing, everyday life and psychology' },
  { id: 'study', name: 'Quiet study', summary: 'Hand-drawn on paper, ink lines and light washes; for books, history and methods' },
  { id: 'whiteboard', name: 'Whiteboard', summary: 'Marker on a whiteboard, drawn while explaining; for breaking down concepts, business models, methods and processes' },
  { id: 'chalkboard', name: 'Chalkboard', summary: 'Chalk on a dark green board; for maths, physics, history and other step-by-step classroom explanations' },
  { id: 'tech-dark', name: 'Dark technical', summary: 'Clean architecture diagrams and code on dark graphite; for software, AI and how systems work' },
];

/**
 * 「创作偏好」: what the user wrote once in Settings for every film. Last in the system prompt, so the stable part above
 * still caches across users; below the engine's rules, which it never overrides.
 */
export function preferencesSection(preferences?: string) {
  const p = preferences?.trim();
  return p ? `---\n# The user's standing preferences\n\nThe user wrote these in Settings, for every film they make. Follow them wherever they bear on your part of the work. This film's own request, and anything the user says while it is made, come first; the technical rules above always hold.\n\n<preferences>\n${p}\n</preferences>` : '';
}

/** A film's own look on top of its style: notes the user keeps with a style they shaped (in Frametell Cloud, from their
 *  own films). After the style card, so they are read as that style's details, not as a new style. */
export function styleNotesSection(notes?: string) {
  const n = notes?.trim();
  return n ? `---\n# This film's own look\n\nThe user shaped the style above for their films, and keeps these notes with it: how they like it drawn and told. Follow them wherever they bear on your part of the work, as long as the style's rules above still hold. This film's own request, and anything the user says while it is made, come first.\n\n<style-notes>\n${n}\n</style-notes>` : '';
}

export function plannerSystem(style: string, preferences?: string, styleNotes?: string) {
  return [read('PLANNER.md'), '---\n# This film\'s style (the page agent draws to it, so the storyboard must be drawable in it)\n\n' + grammar(style), styleNotesSection(styleNotes), '---\n' + read('LIB.md'), preferencesSection(preferences)].filter(Boolean).join('\n\n');
}
/** the page agent's system prompt: process, the style's grammar, the drawing API, the style's components with a worked
 *  example page, and the wider component library (the stable part of every page session, so it caches well) */
export function pageSystem(style: string, extras: string[] = [], preferences?: string, styleNotes?: string) {
  return [read('PAGE.md'), '---\n# This film\'s style\n\n' + grammar(style), styleNotesSection(styleNotes), '---\n' + read('API.md'), '---\n' + pagePack(style, extras), '---\n' + read('LIB.md'), preferencesSection(preferences)].filter(Boolean).join('\n\n');
}

/** the film's language (narration, on-screen text) and the language the director reports in (the user's) */
export type Lang = 'zh' | 'en';
/** `voice`: the service that voices the narration; absent when the film has no voice. `preferences`: what the user
 *  wants in every film (Settings), read by every session. `styleNotes`: the user's notes for the style this film is
 *  drawn in (a style they shaped), read after the style card */
export interface Brief { topic?: string; audience?: string; durationSec: number; notes?: string; lang?: Lang; replyLang?: Lang; voice?: 'volcengine' | 'elevenlabs'; preferences?: string; styleNotes?: string }

const LANG_NAME: Record<Lang, string> = { zh: 'Simplified Chinese', en: 'English' };
/** the language everything said to the user is written in: the user's own, never the prompts' */
export const replyNote = (replyLang?: Lang, lang?: Lang) => `Write everything you say to the user in ${LANG_NAME[replyLang ?? lang ?? 'zh']}.`;

/** What a stage must know about the language: the film's (narration, on-screen text) and the user's (the reports). It goes
 *  in the user messages, never the system prompts, so every film shares the cached part whatever its language. */
export function langNote(stage: 'storyboard' | 'script' | 'page' | 'revise', lang: Lang = 'zh', replyLang?: Lang) {
  const film = {
    zh: {
      storyboard: 'Film language: **Chinese**. In storyboard.json write `"lang": "zh"`; write title, summary, section, say and each beat\'s object / action / text in Simplified Chinese: on-screen text at most 8 characters per element, and a beat tied to a word names the Chinese word as spoken (`c2:三十年`).',
      script: 'Film language: **Chinese**. A cue is one short spoken sentence in Simplified Chinese, at most 16 characters, 3–8 per page; write numbers in Arabic digits and units as they are spoken (年, 元).',
      page: 'This is a Chinese film: all text on screen (titles, labels, units) is in Simplified Chinese, matching the narration.',
      revise: 'This is a Chinese film: rewrite narration in Simplified Chinese, keeping the number of cues; your notes to the page agent can be in English.',
    },
    en: {
      storyboard: 'Film language: **English**. In storyboard.json write `"lang": "en"`; write title, summary, section, say and each beat\'s object / action / text in English: on-screen text at most 5 English words per element, and a beat tied to a word names the English word (`c2:thirty`).',
      script: 'Film language: **English**. A cue is one short spoken English sentence, at most 12 words, 3–8 per page; write numbers in Arabic digits (1,000, 30%) and units as they are spoken (years, dollars).',
      page: 'This is an English film: all text on screen (titles, labels, units) is in English, matching the narration. English runs longer than Chinese, so leave enough width for text.',
      revise: 'This is an English film: rewrite narration in English, keeping the number of cues; your notes to the page agent can be in English.',
    },
  }[lang][stage];
  // the page agent's one sentence is shown to the user too
  return `\n${film}\n${replyNote(replyLang, lang)}`;
}

/** What a stage must know about the voice. Volcengine reads a tone instruction with each take (ElevenLabs ignores one);
 *  a film with no voice is timed by its cues and may be watched without subtitles, so its picture carries the meaning.
 *  In the user messages, like langNote, so the system prompts stay shared. */
export function voiceNote(stage: 'storyboard' | 'script' | 'revise', voice?: Brief['voice']) {
  if (!voice) return {
    storyboard: 'This film has no voice, and may be watched without subtitles: the picture alone must tell the story, so key words and numbers go on screen as text.',
    script: 'This film has no voice: nobody hears the cues. They time the picture, and become the subtitles if the user turns them on, so write each as a short caption that reads well on its own.',
    revise: 'This film has no voice: the cues only time the picture and serve as subtitles.',
  }[stage];
  if (voice !== 'volcengine') return '';
  return {
    storyboard: '',
    script: [
      "The narrator takes a tone instruction with each page. Give every page an `instruction`: one Chinese sentence on how that page is said (pace, warmth, where the weight falls). It replaces the film's default tone, so write it as a whole direction, e.g. `instruction: '放慢一点，像在揭晓答案，最后一句加重'`. Follow the film's arc: the hook curious and quick, the intuition relaxed, the key page slower and firmer, the close calm.",
      "When one line turns sharply from the rest of its page (a question to the viewer, a punchline, someone else's words quoted), give that cue its own: `{ t: '你猜结果是多少？', solo: { instruction: '真诚地发问，尾音上扬' } }`. A solo line is voiced as a separate take and loses the flow of its page, so use at most one per page and only where the tone really turns; most pages need none.",
    ].join('\n'),
    revise: "When you change a page's cues, keep its `instruction` (and any cue's `solo`) in step with the new lines.",
  }[stage];
}
const withVoice = (stage: 'storyboard' | 'script' | 'revise', brief?: Brief) => { const n = voiceNote(stage, brief?.voice); return n ? `\n${n}` : ''; };

export function storyboardPrompt(brief: Brief, style: string, materials: string[]) {
  return [
    'Stage 1: storyboard.',
    `The request: ${materials.length ? 'turn the material into' : 'make'} an explainer film of about ${Math.round(brief.durationSec / 60 * 10) / 10} minutes.` + (brief.topic ? ` Topic: ${brief.topic}.` : '') + (brief.audience ? ` Audience: ${brief.audience}.` : ''),
    materials.length ? '' : 'There is no material: explain it from your own knowledge. Use only well-established, checkable facts and numbers; when unsure, leave the number out. Every number on screen must also appear in that page\'s say (the server checks where numbers come from against say).',
    brief.notes ? `Further notes from the user: ${brief.notes}` : '',
    `Style: ${style} (write "${style}" as the style in storyboard.json).`,
    `Material: ${materials.map((m) => 'materials/' + m).join(', ') || '(none; write from the topic)'}`,
    'Stop and report once storyboard.json is written.' + withVoice('storyboard', brief) + langNote('storyboard', brief.lang, brief.replyLang),
  ].filter(Boolean).join('\n');
}

export function storyboardFixPrompt(issues: { level: string; page?: string; beat?: number; msg: string }[], brief?: Brief) {
  return ['The server checked storyboard.json; fix the issues below (red must be fixed, yellow at your judgement):', ...issues.map((i) => `- [${i.level === 'red' ? 'red' : 'yellow'}] ${i.page ?? 'whole film'}${i.beat != null ? ` beat ${i.beat + 1}` : ''}: ${i.msg}`), 'Stop once fixed and say in one sentence what you changed. ' + replyNote(brief?.replyLang, brief?.lang)].join('\n');
}

export function scriptPrompt(feedback?: string, brief?: Brief) {
  return [feedback ? `The user's changes to the storyboard: ${feedback}\nFirst update storyboard.json to match, then write the narration.` : 'The user approved the storyboard without changes.', 'Stage 2: write script.js, run node engine/tools/script.mjs to see the estimated length, then stop and report.' + withVoice('script', brief) + langNote('script', brief?.lang, brief?.replyLang)].join('\n');
}

export function pagePrompt(sb: Storyboard, id: string, t: PageTiming, lang: Lang | undefined = sb.lang, replyLang?: Lang, revising = false) {
  const p = sb.pages.find((x) => x.id === id);
  const outline = sb.pages.map((x) => `- ${x.id} ${x.section}`).join('\n');
  return `You own page **${id}**.

The film: ${sb.title} — ${sb.summary}
Its structure:
${outline}

## This page's storyboard
- Section: ${p?.section ?? ''}
- What it says: ${p?.say ?? ''}
- Key page: ${p?.core ? 'yes' : 'no'}
- Beats:
${(p?.beats || []).map((b, i) => `  ${i + 1}. [${b.at}] ${b.object} — ${b.action}${b.camera ? ` (camera: ${b.camera})` : ''}${b.text ? `, on-screen text "${b.text}"` : ''}`).join('\n')}

## This page's narration and timing (real voice)
The page lasts ${(t.end - t.start).toFixed(2)}s; its narration ends at ${(t.speechEnd - t.start).toFixed(2)}s (P.endT).
${t.cues.map((c) => `- c${c.i}: at ${c.at}s in the page, "${c.text}"`).join('\n')}

${revising ? `pages/${id}.js is already written; stop once the change below is made in it and say in one sentence what you changed.` : `Stop once pages/${id}.js is written and say in one sentence what you drew.`}${langNote('page', lang, replyLang)}`;
}

/** what lint reports that is plainly wrong on screen or in the code: a page is not done while one of these is there.
 * The rest (a sparse or wordy page, small or touching text) is advice: some styles mean it, and the pictures decide */
export const hardIssue = (msg: string) => /^(runtime error|unknown API|wrong API use|off-canvas|subtitle band|raw markup|empty opening|empty ending)/.test(msg);

const lintLines = (issues: LintIssue[]) => issues.map((i) => `- ${i.local}s: ${i.msg}`).join('\n');

export function checkPrompt(round: number, issues: LintIssue[], times: { t: number; local: number }[], change?: string) {
  const hard = issues.filter((i) => hardIssue(i.msg)), soft = issues.filter((i) => !hardIssue(i.msg));
  const lint = !issues.length ? 'Lint found nothing.'
    : (hard.length ? `Lint, must fix:\n${lintLines(hard)}\n` : '') + (soft.length ? `Lint, advice only (fix it if the pictures agree; if the page is right as it is, ignore it):\n${lintLines(soft)}` : '');
  return `Check round ${round}.

${lint.trim()}

The attached sheet shows the page at these moments within it (left to right, top to bottom): ${times.map((x) => x.local.toFixed(1) + 's').join(', ')}.
${change ? `The user asked for this change to the page: ${change}\nIf the pictures don't show it yet, make it now: that is what this round is for.\n` : ''}Go through the checklist against the pictures. If something is wrong, fix the page file; if nothing is (advice included), reply only DONE; for a must-fix problem you keep on purpose, or that is a false alarm, reply FLAGGED: <reason>.
Fix with edit, only where the problem is (a size, a position, a moment). **Never rewrite the whole file with write**: a full rewrite takes minutes, one edit takes seconds. No need to read the file again afterwards.
**Put all of this round's edits in one reply** (one reply can call edit several times), each with finish: true: the round ends once they apply, no reply needed, and the server checks again and sends you new pictures.`;
}

/** the agent said DONE with a must-fix problem still on the page: once, plainly, before the page is settled as it is */
export function stillThere(issues: LintIssue[]) {
  return `You replied DONE, but lint still reports these on the page:
${lintLines(issues)}
Fix them now with edit (all edits in one reply, each with finish: true), or if one is intended or a false alarm, reply FLAGGED: <reason>. Don't reply DONE again.`;
}

export function reviewPrompt(issues: LintIssue[], flagged: string[], replyLang?: Lang) {
  return `All pages are done. Now check the **whole film** (not one page). The attached sheet shows each page in the middle and at the end, in page order.
${issues.length ? 'Lint for the whole film:\n' + issues.map((i) => `- ${i.page} ${i.local}s: ${i.msg}`).join('\n') : 'Lint found nothing.'}
${flagged.length ? '\nThese pages still had problems after their own checks: ' + flagged.join('; ') : ''}

Fix locally with edit; never rewrite a whole page file. Fix only problems across pages and obvious defects (styles that don't match, a page that is clearly empty, text off the page or overlapping), at most 2 pages; leave small blemishes. When done, stop and tell the user in one plain sentence which page you changed and how it looks different (e.g. "The timer on page 5 flickered in its second half; that's fixed"), without terms like lint, determinism or p05. If nothing needs changing, reply DONE. ${replyNote(replyLang)}`;
}
