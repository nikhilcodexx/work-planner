/* ===================================================================
   ANIMATIONS.TEST.JS — the background scene must not animate forever
   unconditionally. It must respect prefers-reduced-motion and must
   pause while the tab is hidden.
   =================================================================== */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const animationJs = fs.readFileSync(path.join(__dirname, '..', 'animation.js'), 'utf8');
const { shouldPauseAnimations } = require('../animation.js');

test('style.css has a prefers-reduced-motion block', () => {
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('reduced-motion block disables the decorative scene', () => {
  const match = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{([\s\S]*?)}\s*}/);
  assert.ok(match, 'expected a prefers-reduced-motion block with a body');
  const body = match[1];
  assert.match(body, /\.scene\s*\*/, 'expected the scene to be neutralized under reduced motion');
  assert.match(body, /animation:\s*none/);
});

test('reduced-motion block also neutralizes the critical-task pulse', () => {
  const match = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{([\s\S]*?)}\s*}/);
  const body = match[1];
  assert.match(body, /\.task\.p-critical/, 'expected the critical pulse to be covered too');
});

test('style.css has a paused state driven by tab visibility', () => {
  assert.match(
    css,
    /\.anim-paused[\s\S]*?animation-play-state:\s*paused/,
    'expected a .anim-paused rule that pauses animation-play-state'
  );
});

test('animation.js wires document visibility to the anim-paused class', () => {
  assert.match(animationJs, /visibilitychange/);
  assert.match(animationJs, /document\.hidden/);
  assert.match(animationJs, /anim-paused/);
});

test('shouldPauseAnimations pauses when the tab is hidden', () => {
  assert.equal(shouldPauseAnimations({ hidden: true }), true);
});

test('shouldPauseAnimations does not pause when the tab is visible', () => {
  assert.equal(shouldPauseAnimations({ hidden: false }), false);
});
