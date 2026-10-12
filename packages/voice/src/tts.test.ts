import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elevenLabsTts } from './tts.js';

// a provider that never answers until the request's signal gives up
function hangingFetch(answers: number) {
  let calls = 0;
  const fetch = (_url: string, init: { signal: AbortSignal }) => {
    calls++;
    if (calls > answers) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    const body = { audio_base64: Buffer.from('mp3').toString('base64'), alignment: { characters: ['a'], character_start_times_seconds: [0], character_end_times_seconds: [0.1] } };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  return { fetch, calls: () => calls };
}

function withFakes(fetch: unknown, run: () => Promise<void>) {
  const realFetch = globalThis.fetch, realTimeout = AbortSignal.timeout;
  globalThis.fetch = fetch as typeof globalThis.fetch;
  // the 90 s deadline, shortened (and holding the event loop open, as AbortSignal.timeout's own timer doesn't)
  AbortSignal.timeout = () => { const c = new AbortController(); setTimeout(() => c.abort(new DOMException('timed out', 'TimeoutError')), 50); return c.signal; };
  return run().finally(() => { globalThis.fetch = realFetch; AbortSignal.timeout = realTimeout; });
}

test('a take that never answers times out and is asked again, even with a stop signal', async () => {
  const f = hangingFetch(0);
  let n = 0;
  const flaky = (url: string, init: { signal: AbortSignal }) => (n++ === 0 ? f.fetch(url, init) : hangingFetch(1).fetch(url, init));
  await withFakes(flaky, async () => {
    const out = await elevenLabsTts('k').synth('hello', { voice: 'v', signal: new AbortController().signal });
    assert.equal(out.words.length, 1);
    assert.equal(n, 2);
  });
});

test('stopping a film ends a waiting take at once, without asking again', async () => {
  const f = hangingFetch(0);
  await withFakes(f.fetch, async () => {
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 10);
    await assert.rejects(elevenLabsTts('k').synth('hello', { voice: 'v', signal: stop.signal }), { name: 'AbortError' });
    assert.equal(f.calls(), 1);
  });
});
