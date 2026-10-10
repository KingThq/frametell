// System prompts for each stage, assembled from prompts/*.md and the chosen style's grammar card, and the per-stage
// user messages. Stable text first (system), changing text last (user), so provider prompt caches stay warm.
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_DIR } from '@frametell/engine/tools/project.mjs';
import type { PageTiming, Storyboard, LintIssue } from './project.js';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../prompts');
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');
const grammar = (style: string) => {
  const f = path.join(ENGINE_DIR, 'styles', style, 'GRAMMAR.md');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : `风格：${style}`;
};

export const STYLES: { id: string; name: string; summary: string }[] = [
  { id: 'warm-story', name: '暖调叙事插画', summary: '温暖的扁平插画，一个比喻物贯穿全片，适合投资、生活、心理类知识' },
  { id: 'study', name: '安静书房', summary: '纸面手绘，墨线与淡彩，适合读书、历史、方法论' },
];

export function plannerSystem(style: string) {
  return [read('PLANNER.md'), '---\n# 本片风格（画面 Agent 会照着画，分镜要写得出来）\n\n' + grammar(style), '---\n' + read('LIB.md')].join('\n\n');
}
export function pageSystem(style: string) {
  return [read('PAGE.md'), '---\n# 本片风格\n\n' + grammar(style), '---\n' + read('API.md'), '---\n' + read('LIB.md')].join('\n\n');
}

export interface Brief { topic?: string; audience?: string; durationSec: number; notes?: string }

export function storyboardPrompt(brief: Brief, style: string, materials: string[]) {
  return [
    '阶段 1：分镜。',
    `用户需求：把资料做成一条约 ${Math.round(brief.durationSec / 60 * 10) / 10} 分钟的讲解视频。` + (brief.topic ? `主题：${brief.topic}。` : '') + (brief.audience ? `观众：${brief.audience}。` : ''),
    brief.notes ? `补充要求：${brief.notes}` : '',
    `风格：${style}（storyboard.json 的 style 写 "${style}"）。`,
    `资料：${materials.map((m) => 'materials/' + m).join('、') || '（无，按主题写）'}`,
    '写好 storyboard.json 后停下汇报。',
  ].filter(Boolean).join('\n');
}

export function storyboardFixPrompt(issues: { level: string; page?: string; beat?: number; msg: string }[]) {
  return ['服务端检查了 storyboard.json，下面这些问题要改（红色必须改，黄色酌情）：', ...issues.map((i) => `- [${i.level === 'red' ? '红' : '黄'}] ${i.page ?? '全片'}${i.beat != null ? ` 拍点${i.beat + 1}` : ''}：${i.msg}`), '改好后停下，一句话说明改了什么。'].join('\n');
}

export function scriptPrompt(feedback?: string) {
  return [feedback ? `用户对分镜的修改意见：${feedback}\n先按意见改好 storyboard.json，再写口播。` : '用户已确认分镜，没有修改。', '阶段 2：写 script.js，运行 node engine/tools/script.mjs 看估算时长，然后停下汇报。'].join('\n');
}

export function pagePrompt(sb: Storyboard, id: string, t: PageTiming) {
  const p = sb.pages.find((x) => x.id === id);
  const outline = sb.pages.map((x) => `- ${x.id} ${x.section}`).join('\n');
  return `你负责 **${id}** 这一页。

全片：${sb.title} —— ${sb.summary}
全片结构：
${outline}

## 本页分镜
- 章节：${p?.section ?? ''}
- 讲什么：${p?.say ?? ''}
- 核心镜头：${p?.core ? '是' : '否'}
- 拍点：
${(p?.beats || []).map((b, i) => `  ${i + 1}. [${b.at}] ${b.object} —— ${b.action}${b.camera ? `（镜头：${b.camera}）` : ''}${b.text ? `，屏上字「${b.text}」` : ''}`).join('\n')}

## 本页口播与时间（真实配音）
本页长 ${(t.end - t.start).toFixed(2)}s，口播在 ${(t.speechEnd - t.start).toFixed(2)}s 结束（P.endT）。
${t.cues.map((c) => `- c${c.i}：页内 ${c.at}s「${c.text}」`).join('\n')}

写好 pages/${id}.js 后停下，一句话说明你画了什么。`;
}

export function checkPrompt(round: number, issues: LintIssue[], times: { t: number; local: number }[]) {
  const lint = issues.length ? issues.map((i) => `- ${i.local}s：${i.msg}`).join('\n') : '（lint 没有发现问题）';
  return `第 ${round} 轮检查。

lint 结果：
${lint}

附图是本页在这些页内时刻的截图（从左到右、从上到下）：${times.map((x) => x.local.toFixed(1) + 's').join('、')}。
对照清单认真看图。有问题就改好 pages 文件再停下；没有问题只回复 DONE；有意保留的问题回复 FLAGGED: 原因。`;
}

export function reviewPrompt(issues: LintIssue[], flagged: string[]) {
  return `全部页面已完成，现在做**全片检查**（不是某一页）。附图是每页中段和结尾的截图，按页顺序排列。
${issues.length ? '全片 lint 结果：\n' + issues.map((i) => `- ${i.page} ${i.local}s：${i.msg}`).join('\n') : 'lint 没有发现问题。'}
${flagged.length ? '\n这些页自检后仍有问题：' + flagged.join('；') : ''}

只修跨页的问题和明显的缺陷（风格不统一、某页明显空、文字出界或重叠），最多改 2 页；小瑕疵不改。改完停下，一句话汇报；没有要改的就回复 DONE。`;
}
