/* ===================================================================
   SECURITY.TEST.JS — supply-chain hardening for third-party scripts.
   The one external script this app loads (Lucide icons from a CDN)
   must be version-pinned with a Subresource Integrity hash, so a
   future release — or a compromised package/CDN — can't silently run
   with full page privileges.
   =================================================================== */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('the CDN script tag does not use a floating "@latest" version', () => {
  assert.doesNotMatch(html, /unpkg\.com\/lucide@latest/);
});

test('the CDN script tag has a Subresource Integrity hash and crossorigin attribute', () => {
  const match = html.match(/<script\s+src="https:\/\/unpkg\.com\/lucide@[^"]+"[^>]*>/);
  assert.ok(match, 'expected a pinned lucide <script> tag');
  assert.match(match[0], /integrity="sha384-[A-Za-z0-9+/=]+"/);
  assert.match(match[0], /crossorigin="anonymous"/);
});
