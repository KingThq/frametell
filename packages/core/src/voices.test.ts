import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ElevenLabsError, listElevenLabsVoices, volcengineResources } from '@frametell/voice';
import { patchConfig, withDefaults } from './config.js';

test('a Volcengine voice id is tried on the resources it likely belongs to, likeliest first', () => {
  assert.deepEqual(volcengineResources('zh_female_vv_uranus_bigtts').slice(0, 1), ['seed-tts-2.0']);
  assert.deepEqual(volcengineResources('zh_female_shuangkuaisisi_moon_bigtts').slice(0, 1), ['seed-tts-1.0']);
  assert.deepEqual(volcengineResources('zh_male_beijingxiaoye_emo_v2_mars_bigtts').slice(0, 1), ['seed-tts-1.0']);
  assert.deepEqual(volcengineResources('S_abc123'), ['seed-icl-2.0', 'seed-icl-1.0']);
  assert.equal(volcengineResources('something_else').length, 4);
});

test('「我的音色」 can be renamed and trimmed through settings, but a voice is only added by checking it', () => {
  const c = withDefaults({ myVoices: [{ provider: 'volcengine', id: 'S_a', name: '我' }, { provider: 'volcengine', id: 'S_b', name: 'b' }] });
  const renamed = patchConfig(c, { myVoices: [{ provider: 'volcengine', id: 'S_a', name: '  旁白  ' }, { provider: 'volcengine', id: 'S_b', name: '' }] });
  assert.deepEqual(renamed.myVoices, [{ provider: 'volcengine', id: 'S_a', name: '旁白' }, { provider: 'volcengine', id: 'S_b', name: 'b' }]);
  assert.deepEqual(patchConfig(c, { myVoices: [{ provider: 'volcengine', id: 'S_b' }] }).myVoices, [{ provider: 'volcengine', id: 'S_b', name: 'b' }]);
  assert.deepEqual(patchConfig(c, { myVoices: [{ provider: 'volcengine', id: 'S_new', name: 'x' }] }).myVoices, []);
});

test('an ElevenLabs voice list that fails says why: permission, key, network or other', async () => {
  const real = globalThis.fetch;
  const answer = (status: number, detail: unknown) => async () => new Response(JSON.stringify({ detail }), { status });
  const why = async () => { try { await listElevenLabsVoices('k'); return 'listed'; } catch (e) { return e instanceof ElevenLabsError ? e.problem : 'thrown'; } };
  try {
    globalThis.fetch = answer(401, { status: 'missing_permissions', message: 'The API key you used is missing the permission voices_read to execute this operation.' });
    assert.equal(await why(), 'permission');
    globalThis.fetch = answer(401, { type: 'authentication_error', code: 'unauthorized', message: 'Invalid API key', status: 'invalid_api_key' });
    assert.equal(await why(), 'key');
    globalThis.fetch = answer(500, 'boom');
    assert.equal(await why(), 'other');
    globalThis.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); };
    assert.equal(await why(), 'network');
  } finally { globalThis.fetch = real; }
});
