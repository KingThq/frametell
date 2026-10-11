import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crashText } from './director.js';

const raw = `lint failed: node:internal/modules/run_main:123
    triggerUncaughtException(
    ^

page.evaluate: TypeError: e is not a function
    at PV.K (file:///x/projects/a/engine/runtime/live.js:7:48)
    at kick (file:///x/projects/a/pages/p03.js:37:27)
    at P.follow.size (file:///x/projects/a/pages/p03.js:90:3)`;

test('a crash comes back as the error and where in the page it happened', () => {
  const c = crashText(raw, 'p03');
  assert.match(c, /^TypeError: e is not a function/);
  assert.match(c, /at engine\/runtime\/live\.js:7:48/);
  assert.match(c, /at pages\/p03\.js:37:27/);
  assert.doesNotMatch(c, /node:internal|triggerUncaught|file:\/\//);
});
