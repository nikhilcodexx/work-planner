/* ===================================================================
   RENDER.TEST.JS — search should be debounced, not re-render the
   whole app on every keystroke; matchesSearch should keep matching
   correctly once debounced.
   =================================================================== */
const test = require('node:test');
const assert = require('node:assert/strict');

const { debounce, matchesSearch } = require('../script.js');

test('debounce collapses a burst of calls into one, using the latest args', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const fn = debounce((...args) => calls.push(args), 150);

  fn('a');
  fn('b');
  fn('c');
  assert.equal(calls.length, 0, 'should not fire before the delay elapses');

  t.mock.timers.tick(150);
  assert.deepEqual(calls, [['c']], 'should fire exactly once, with the latest args');
});

test('matchesSearch matches on title, description, section, block, tags, and notes', () => {
  const task = {
    title: 'Write report', description: 'Quarterly numbers',
    section: 'Focus', block: 'Work', tags: ['urgent', 'q3'], notes: 'ping finance',
  };
  assert.equal(matchesSearch(task, 'report'), true);
  assert.equal(matchesSearch(task, 'quarterly'), true);
  assert.equal(matchesSearch(task, 'focus'), true);
  assert.equal(matchesSearch(task, 'q3'), true);
  assert.equal(matchesSearch(task, 'finance'), true);
});

test('matchesSearch is case-insensitive and returns false for a non-match', () => {
  const task = { title: 'Write Report', description: '', section: '', block: '', tags: [], notes: '' };
  assert.equal(matchesSearch(task, 'WRITE'), true);
  assert.equal(matchesSearch(task, 'nope'), false);
});
