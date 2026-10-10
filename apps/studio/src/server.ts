// The local server: the panel's API, the live event stream (SSE), project previews and the built panel itself.
// It listens on 127.0.0.1 only, and every /api call needs the per-launch token the CLI puts in the panel URL.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { streamSSE } from 'hono/streaming';
import { getCookie, setCookie } from 'hono/cookie';
import { createCatalog } from '@frametell/models';
import { listElevenLabsVoices, VOLCENGINE_VOICES } from '@frametell/voice';
import { STYLES } from '@frametell/agent';
import { loadConfig, patchConfig, publicConfig, saveConfig } from './config.js';
import { listProjects, newProject, projectDir, readMeta, runner, type Logged } from './runner.js';
import { checkEnv } from './env.js';

const WEB_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../web/dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.srt': 'text/plain; charset=utf-8',
};

/** a file under root (symlinks inside root, like engine/, are followed), or null */
function safeFile(root: string, rel: string): string | null {
  const abs = path.resolve(root, decodeURIComponent(rel));
  const r = path.relative(root, abs);
  if (r.startsWith('..') || path.isAbsolute(r)) return null;
  try { return fs.statSync(abs).isFile() ? abs : null; } catch { return null; }
}

function sendFile(c: Context, file: string) {
  const stat = fs.statSync(file);
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = c.req.header('range');
  if (range && /^bytes=\d*-\d*$/.test(range)) {   // video seeking
    const [a, b] = range.slice(6).split('-');
    const start = a ? +a : 0, end = b ? Math.min(+b, stat.size - 1) : stat.size - 1;
    return new Response(fs.createReadStream(file, { start, end }) as unknown as ReadableStream, {
      status: 206, headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(fs.createReadStream(file) as unknown as ReadableStream, { headers: { 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' } });
}

export function createServer(opts: { token?: string } = {}) {
  const token = opts.token || crypto.randomBytes(16).toString('hex');
  const app = new Hono();

  // the panel opens with ?token=…; the token then lives in an httpOnly cookie
  app.use('*', async (c, next) => {
    const q = c.req.query('token');
    if (q === token) setCookie(c, 'fs_token', token, { httpOnly: true, sameSite: 'Strict', path: '/' });
    const ok = q === token || getCookie(c, 'fs_token') === token || c.req.header('x-studio-token') === token;
    if ((c.req.path.startsWith('/api') || c.req.path.startsWith('/p/')) && !ok) return c.json({ error: '需要从 frametell 打开的链接访问' }, 401);
    await next();
  });

  // ── settings ──
  app.get('/api/settings', (c) => c.json(publicConfig(loadConfig())));
  app.put('/api/settings', async (c) => { const next = patchConfig(loadConfig(), await c.req.json()); saveConfig(next); return c.json(publicConfig(next)); });
  app.get('/api/env', (c) => c.json(checkEnv()));
  app.get('/api/styles', (c) => c.json(STYLES));

  app.get('/api/models', async (c) => {
    const cfg = loadConfig();
    const catalog = await createCatalog({ keys: Object.entries(cfg.keys).map(([providerId, apiKey]) => ({ providerId, apiKey })), custom: cfg.custom });
    return c.json({ models: await catalog.available(), default: await catalog.defaultModel() });
  });

  app.get('/api/voices', async (c) => {
    const cfg = loadConfig();
    const voices = cfg.tts.volcengine ? [...VOLCENGINE_VOICES] : [];
    if (cfg.tts.elevenlabs) { try { voices.push(...(await listElevenLabsVoices(cfg.tts.elevenlabs))); } catch {} }
    return c.json({ voices, configured: { volcengine: !!cfg.tts.volcengine, elevenlabs: !!cfg.tts.elevenlabs } });
  });

  // ── projects ──
  app.get('/api/projects', (c) => c.json(listProjects()));

  app.post('/api/projects', async (c) => {
    const form = await c.req.formData();
    const files: { name: string; data: Buffer }[] = [];
    for (const v of form.getAll('materials')) if (typeof v !== 'string') files.push({ name: v.name, data: Buffer.from(await v.arrayBuffer()) });
    const cfg = loadConfig();
    const str = (k: string) => { const v = form.get(k); return typeof v === 'string' && v.trim() ? v.trim() : undefined; };
    const voice = str('voice') ? JSON.parse(str('voice')!) : cfg.defaults.voice;
    const meta = newProject({
      title: str('title') || files[0]?.name.replace(/\.[^.]+$/, '') || '未命名视频',
      style: str('style') || cfg.defaults.style,
      durationSec: +(str('durationSec') || cfg.defaults.durationSec),
      model: str('model') || cfg.defaults.model || '',
      runtime: (str('runtime') as any) || cfg.defaults.runtime,
      voice, subtitles: str('subtitles') !== 'false',
      topic: str('topic'), notes: str('notes'),
    }, files);
    if (!meta.model) return c.json({ error: '请先在设置里配置模型' }, 400);
    void runner(meta.id).start();
    return c.json(meta, 201);
  });

  app.get('/api/projects/:id', (c) => {
    const id = c.req.param('id');
    try { return c.json({ ...readMeta(id), ...runner(id).summary() }); } catch { return c.json({ error: '项目不存在' }, 404); }
  });
  app.post('/api/projects/:id/start', async (c) => { await runner(c.req.param('id')).start(); return c.json({ ok: true }); });
  app.post('/api/projects/:id/approve', async (c) => {
    const { feedback } = await c.req.json().catch(() => ({ feedback: undefined }));
    return c.json({ ok: runner(c.req.param('id')).approve(feedback) });
  });
  app.post('/api/projects/:id/stop', (c) => { runner(c.req.param('id')).stop(); return c.json({ ok: true }); });

  // live events: replay after Last-Event-ID (or ?since=), then stream
  app.get('/api/projects/:id/events', (c) => {
    const id = c.req.param('id');
    const since = +(c.req.header('last-event-id') || c.req.query('since') || 0);
    return streamSSE(c, async (stream) => {
      const queue: Logged[] = [];
      let wake: (() => void) | undefined;
      const off = runner(id).subscribe((e) => { queue.push(e); wake?.(); }, since);
      stream.onAbort(() => { off(); wake?.(); });
      while (!stream.aborted) {
        while (queue.length) { const e = queue.shift()!; await stream.writeSSE({ id: String(e.seq), event: e.type, data: JSON.stringify(e) }); }
        await Promise.race([new Promise<void>((r) => (wake = r)), stream.sleep(15_000)]);
        if (!queue.length && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '' });
      }
      off();
    });
  });

  // project files: the preview player (index.html + engine), snapshots, audio, the finished video
  app.get('/p/:id/*', (c) => {
    const id = c.req.param('id');
    const rel = c.req.path.slice(`/p/${id}/`.length) || 'index.html';
    const f = safeFile(projectDir(id), rel);
    return f ? sendFile(c, f) : c.notFound();
  });

  // the panel (single-page app)
  app.get('*', (c) => {
    const f = safeFile(WEB_DIR, c.req.path.slice(1)) || safeFile(WEB_DIR, 'index.html');
    return f ? sendFile(c, f) : c.text('面板还没有构建：pnpm --filter frametell build:web', 503);
  });

  return { app, token };
}

export function startServer(port = 5317, host = '127.0.0.1') {
  const { app, token } = createServer();
  const server = serve({ fetch: app.fetch, port, hostname: host });
  return { server, token, url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/?token=${token}` };
}
