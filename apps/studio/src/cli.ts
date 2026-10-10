#!/usr/bin/env node
// frametell run <material…> [--style warm-story] [--duration 60] [--model relay/gemini-3.7-flash-high]
//                     [--runtime pi|claude|codex] [--voice zh_male_yuanboxiaoshu_uranus_bigtts] [--title …] [--out dir]
// Headless end-to-end run: storyboard (auto-approved) → script → narration → pages → review → render.
// Keys come from the environment: RELAY_API_KEY (recommended), ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY,
// OPENROUTER_API_KEY, AI_GATEWAY_API_KEY, VOLCENGINE_ARK_API_KEY …; narration: VOLCENGINE_TTS_API_KEY or ELEVENLABS_API_KEY.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject } from '@frametell/engine/tools/project.mjs';
import { createCatalog, RELAY_BASE_URL, type ProviderKey } from '@frametell/models';
import { elevenLabsTts, volcengineTts } from '@frametell/voice';
import { Director, piRuntime, claudeRuntime, codexRuntime, type AgentRuntime, type StudioEvent } from '@frametell/agent';

const ENV_KEYS: Record<string, string> = {
  relay: 'RELAY_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY', 'vercel-ai-gateway': 'AI_GATEWAY_API_KEY', deepseek: 'DEEPSEEK_API_KEY', 'volcengine-ark': 'VOLCENGINE_ARK_API_KEY',
};

function args(argv: string[]) {
  const o: Record<string, string> = {}, pos: string[] = [];
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i]; else pos.push(argv[i]); }
  return { o, pos };
}
const sec = (t0: number) => ((Date.now() - t0) / 1000).toFixed(0).padStart(4) + 's';

async function run(argv: string[]) {
  const { o, pos } = args(argv);
  if (!pos.length) { console.error('用法：frametell run <资料文件…> [--style warm-story] [--duration 60] [--model relay/gemini-3.7-flash-high]'); process.exit(1); }
  const keys: ProviderKey[] = Object.entries(ENV_KEYS).filter(([, env]) => process.env[env]).map(([providerId, env]) => ({ providerId, apiKey: process.env[env]! }));
  const catalog = await createCatalog({ keys });
  const [prov, ...rest] = (o.model || '').split('/');
  const info = o.model ? catalog.info(catalog.get(prov, rest.join('/'))!) : await catalog.defaultModel();
  if (!info) throw new Error('没有可用的模型：请设置 RELAY_API_KEY（推荐）或其他 provider 的 key');
  const runtimeId = o.runtime || 'pi';
  let runtime: AgentRuntime;
  if (runtimeId === 'claude') runtime = claudeRuntime({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.RELAY_API_KEY || '', baseUrl: process.env.ANTHROPIC_API_KEY ? undefined : RELAY_BASE_URL, model: info.id });
  else if (runtimeId === 'codex') runtime = codexRuntime({ apiKey: process.env.OPENAI_API_KEY || process.env.RELAY_API_KEY || '', baseUrl: process.env.OPENAI_API_KEY ? undefined : RELAY_BASE_URL + '/v1', model: info.id });
  else runtime = piRuntime(catalog.models, catalog.get(info.provider, info.id)!);

  const tts = process.env.VOLCENGINE_TTS_API_KEY ? volcengineTts(process.env.VOLCENGINE_TTS_API_KEY) : process.env.ELEVENLABS_API_KEY ? elevenLabsTts(process.env.ELEVENLABS_API_KEY) : undefined;
  const voice = tts ? { speaker: o.voice || (tts.id === 'volcengine' ? 'zh_male_yuanboxiaoshu_uranus_bigtts' : 'JBFqnCBsd6RMkjVDRZzb'), rate: 0, instruction: '像跟朋友分享一个实用的发现，语气轻松、真诚、自然，有轻重缓急' } : undefined;

  const style = o.style || 'warm-story';
  const title = o.title || path.basename(pos[0]).replace(/\.[^.]+$/, '');
  const dir = path.resolve(o.out || path.join(os.homedir(), '.frametell', 'projects', `${new Date().toISOString().slice(0, 10)}-${title}-${Date.now().toString(36)}`));
  if (!fs.existsSync(path.join(dir, 'script.js'))) {
    createProject(dir, { title, style });
    fs.mkdirSync(path.join(dir, 'materials'), { recursive: true });
    for (const f of pos) fs.copyFileSync(f, path.join(dir, 'materials', path.basename(f)));
  }
  console.log(`项目 ${dir}\n模型 ${info.providerName} / ${info.name}（${runtime.id}）· 风格 ${style} · 配音 ${tts ? tts.id : '无'}`);

  const t0 = Date.now(), stageAt: Record<string, number> = {};
  const emit = (e: StudioEvent) => {
    if (e.type === 'stage') {
      if (e.status === 'start') stageAt[e.stage] = Date.now();
      console.log(`[${sec(t0)}] ${e.status === 'start' ? '▶' : e.status === 'done' ? '✓' : e.status === 'skipped' ? '·' : '✗'} ${e.stage}${e.status !== 'start' && stageAt[e.stage] ? ` ${sec(stageAt[e.stage]).trim()}` : ''}${e.detail ? '  ' + e.detail : ''}`);
    } else if (e.type === 'storyboard_check') console.log(`[${sec(t0)}]   分镜检查第 ${e.round} 轮：${e.issues.filter((i) => i.level === 'red').length} 红 ${e.issues.filter((i) => i.level !== 'red').length} 黄`);
    else if (e.type === 'page') console.log(`[${sec(t0)}]   ${e.id} ${e.status}${e.round ? ` 第${e.round}轮` : ''}${e.issues?.length ? ` · ${e.issues.length} 个问题` : ''}`);
    else if (e.type === 'agent' && e.event.type === 'tool_start') console.log(`[${sec(t0)}]     ${e.session} 🔧 ${e.event.name} ${e.event.summary.slice(0, 90)}`);
    else if (e.type === 'agent' && e.event.type === 'text') console.log(`[${sec(t0)}]     ${e.session} 💬 ${e.event.text.replace(/\s+/g, ' ').slice(0, 140)}`);
    else if (e.type === 'gate') console.log(`[${sec(t0)}]   成片门禁：${e.red ? '红灯 ' + JSON.stringify(e.blank) : '通过'}`);
    else if (e.type === 'error') console.log(`[${sec(t0)}] ✗ ${e.message}`);
  };
  const director = new Director({ dir, runtime, style, brief: { durationSec: +(o.duration || 60), topic: o.topic }, tts, voice, prices: { ...info.cost, currency: info.currency }, concurrency: +(o.concurrency || 3), emit });
  const out = await director.run();
  const u = director.usage, c = director.cost();
  console.log(`\n完成 ${sec(t0).trim()} · 成片 ${out.withSubs}`);
  console.log(`token：输入 ${u.input} · 缓存读 ${u.cacheRead} · 缓存写 ${u.cacheWrite} · 输出 ${u.output} · 约 ${c.currency === 'CNY' ? '¥' : '$'}${c.amount.toFixed(2)}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'run') run(rest).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
else { console.log('frametell run <资料…>  无界面跑完整条流程（面板开发中）'); }
