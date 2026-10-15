import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchConfig, publicConfig, withDefaults } from './config.js';
import { researchPlan } from './runner.js';
import type { ProjectMeta } from './types.js';

const meta = (m: Partial<ProjectMeta>): ProjectMeta => ({ id: 'x', title: 't', createdAt: '', updatedAt: '', style: 'warm-story', durationSec: 60, model: 'a/b', runtime: 'pi', subtitles: true, materials: [], ...m });

test('research runs for links, and searches the web only when it may', () => {
  const keyed = withDefaults({ search: { tavily: 'tvly-1' } });
  const none = withDefaults({});
  // a topic alone: the web is searched when an engine is set up, otherwise there is nothing to research
  assert.equal(researchPlan(meta({ topic: '复利' }), keyed, true)?.search, true);
  assert.equal(researchPlan(meta({ topic: '复利' }), none, true), undefined);
  // with material: only the material, unless the user asked for the web
  assert.equal(researchPlan(meta({ notes: '讲讲这份报告', materials: ['r.pdf'] }), keyed, true), undefined);
  assert.equal(researchPlan(meta({ notes: '讲讲这份报告', materials: ['r.pdf'], research: true }), keyed, true)?.search, true);
  // and a topic the user turned it off for
  assert.equal(researchPlan(meta({ topic: '复利', research: false }), keyed, true), undefined);
  // a link is read even with no search engine
  const repo = researchPlan(meta({ topic: '讲讲 https://github.com/a/b' }), none, true);
  assert.equal(repo?.search, false);
  assert.equal(repo?.sources.repos[0].name, 'b');
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
});
