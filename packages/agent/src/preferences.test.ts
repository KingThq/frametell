import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageSystem, plannerSystem, preferencesSection } from './prompts.js';

test('「创作偏好」 close the director\'s and the page agents\' system prompts, and leave them as they were when empty', () => {
  const prefs = '- 旁白像跟朋友聊天\n- 每页只讲一件事';
  for (const sys of [plannerSystem('warm-story', prefs), pageSystem('warm-story', [], prefs)]) {
    assert.ok(sys.endsWith(`<preferences>\n${prefs}\n</preferences>`));
    assert.match(sys, /This film's own request, and anything the user says while it is made, come first/);
  }
  assert.equal(plannerSystem('warm-story', '  \n '), plannerSystem('warm-story'));
  assert.equal(pageSystem('warm-story', [], ''), pageSystem('warm-story'));
  assert.equal(preferencesSection(undefined), '');
});
