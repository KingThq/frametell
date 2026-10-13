import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageSystem, plannerSystem, styleNotesSection } from './prompts.js';

test('a film\'s style notes follow its style card in the director\'s and the page agents\' system prompts', () => {
  const notes = '- 开场先给一整页留白\n- 每页最多一行题字';
  for (const sys of [plannerSystem('warm-story', undefined, notes), pageSystem('warm-story', [], undefined, notes)]) {
    const card = sys.indexOf("# This film's style");
    const own = sys.indexOf("# This film's own look");
    assert.ok(card >= 0 && own > card, 'the notes come after the style card');
    assert.ok(sys.includes(`<style-notes>\n${notes}\n</style-notes>`));
  }
});

test('with preferences too, the preferences still close the prompt', () => {
  const sys = plannerSystem('warm-story', '- 旁白像聊天', '- 留白多一点');
  assert.ok(sys.endsWith('<preferences>\n- 旁白像聊天\n</preferences>'));
  assert.ok(sys.indexOf('<style-notes>') < sys.indexOf('<preferences>'));
});

test('no notes leave the prompts as they were', () => {
  assert.equal(plannerSystem('warm-story', undefined, '  \n'), plannerSystem('warm-story'));
  assert.equal(pageSystem('warm-story', [], undefined, ''), pageSystem('warm-story'));
  assert.equal(styleNotesSection(undefined), '');
});
