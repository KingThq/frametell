import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchConfig, publicConfig, withDefaults } from './config.js';
import { FULL_REACH, researchPlan } from './runner.js';
import type { ProjectMeta } from './types.js';

const meta = (m: Partial<ProjectMeta>): ProjectMeta => ({ id: 'x', title: 't', createdAt: '', updatedAt: '', style: 'warm-story', durationSec: 60, model: 'a/b', runtime: 'pi', subtitles: true, materials: [], ...m });

test('research runs for links, and searches the web only when it may', () => {
  const keyed = withDefaults({ search: { tavily: 'tvly-1' } });
  const none = withDefaults({});
  // a topic alone: the web is searched when an engine is set up, otherwise there is nothing to research
  assert.equal(researchPlan(meta({ topic: '复利' }), keyed)?.search, true);
  assert.equal(researchPlan(meta({ topic: '复利' }), none), undefined);
  // with material: only the material, unless the user asked for the web
  assert.equal(researchPlan(meta({ notes: '讲讲这份报告', materials: ['r.pdf'] }), keyed), undefined);
  assert.equal(researchPlan(meta({ notes: '讲讲这份报告', materials: ['r.pdf'], research: true }), keyed)?.search, true);
  // and a topic the user turned it off for
  assert.equal(researchPlan(meta({ topic: '复利', research: false }), keyed), undefined);
  // a link is read even with no search engine
  const repo = researchPlan(meta({ topic: '讲讲 https://github.com/a/b' }), none);
  assert.equal(repo?.search, false);
  assert.equal(repo?.sources.repos[0].name, 'b');
});

test('a host\'s reach decides what research may read: no web means no search, no page and no clone, whatever the keys', () => {
  const keyed = withDefaults({ search: { tavily: 'tvly-1' } });
  const sandboxed = { localFiles: false, web: false };
  // a topic alone, keys and all: nothing to research without the web
  assert.equal(researchPlan(meta({ topic: '复利' }), keyed, sandboxed), undefined);
  assert.equal(researchPlan(meta({ topic: '复利', research: true }), keyed, sandboxed), undefined);
  // links and repositories stay in the request's words; none is read or cloned
  assert.equal(researchPlan(meta({ topic: '讲讲 https://github.com/a/b 和 https://example.com/x' }), keyed, sandboxed), undefined);
  // a path on this machine is never read when local files are off, even with the web on
  assert.equal(researchPlan(meta({ notes: `看看 "${process.cwd()}"` }), withDefaults({}), { localFiles: false, web: true }), undefined);
  assert.deepEqual(researchPlan(meta({ notes: `看看 "${process.cwd()}"` }), withDefaults({}), FULL_REACH)?.sources.local, [process.cwd()]);
  // the web on, local files off (the hosted default before sandboxes): links are still read
  assert.equal(researchPlan(meta({ topic: '讲讲 https://github.com/a/b' }), withDefaults({}), { localFiles: false, web: true })?.sources.repos[0].name, 'b');
});

test('search keys are saved trimmed, shown masked, and removed with an empty string', () => {
  let c = withDefaults({});
  c = patchConfig(c, { search: { tavily: ' tvly-aaaaaaaaaaaa1111 , tvly-bbbbbbbbbbbb2222 ', provider: 'tavily' } });
  assert.equal(c.search.tavily, 'tvly-aaaaaaaaaaaa1111,tvly-bbbbbbbbbbbb2222');
  const p = publicConfig(c).search;
  assert.equal(p.provider, 'tavily');
  assert.equal(p.tavily, 'tvly-aaa…1111, tvly-bbb…2222');
  assert.equal(p.serper, '');
  c = patchConfig(c, { search: { tavily: '', provider: 'nope' as never } });
  assert.equal(c.search.tavily, undefined);
  assert.equal(c.search.provider, undefined);
  assert.equal(publicConfig(c).search.provider, '');
  // a host's settings written before search existed are shown without it
  assert.equal(publicConfig({ ...withDefaults({}), search: undefined } as never).search.provider, '');
});
